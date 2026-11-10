import { domParser } from "./utils"

const MAX_QUERY_LENGTH = 3500
const MAX_TEXTS_PER_REQUEST = 20
const SKIP_SELECTOR = "script, style, noscript, code, pre, svg"
const UNIT_SELECTOR =
    "p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, figcaption, " +
    "dt, dd, caption, summary, div, section, article, main"
const SKIP_TAGS = new Set(["script", "style", "noscript", "code", "pre", "svg"])
const VOID_TAGS = new Set([
    "br",
    "img",
    "hr",
    "input",
    "iframe",
    "video",
    "audio",
])

type TextRecord = {
    node: Text
    lead: string
    core: string
    trail: string
}

type SerializedUnit = {
    element: Element
    text: string
    tokens: Map<number, Element>
    order: string[]
}

function splitWhitespace(text: string) {
    const lead = /^\s*/.exec(text)[0]
    const trail = /\s*$/.exec(text)[0]
    return {
        lead,
        trail,
        core: text.slice(lead.length, text.length - trail.length),
    }
}

async function translateAll(
    texts: string[],
    target: string
): Promise<string[]> {
    const results = new Array<string>(texts.length)
    let start = 0
    while (start < texts.length) {
        let end = start
        let length = 0
        while (end < texts.length && end - start < MAX_TEXTS_PER_REQUEST) {
            const nextLength = texts[end].length + 2
            if (end > start && length + nextLength > MAX_QUERY_LENGTH) break
            length += nextLength
            end++
        }
        const chunk = texts.slice(start, end)
        try {
            const translated = await globalThis.translate.translateTexts(
                chunk,
                target
            )
            for (let i = 0; i < chunk.length; i++) {
                const text = translated?.[i]
                results[start + i] =
                    typeof text === "string" && text.trim() ? text : chunk[i]
            }
        } catch {
            for (let i = 0; i < chunk.length; i++) {
                results[start + i] = chunk[i]
            }
        }
        start = end
    }
    return results
}

// Translate the innermost block containers as whole units so that inline
// markup does not split sentences into fragments.
function collectUnits(body: HTMLElement): Element[] {
    return Array.from(body.querySelectorAll(UNIT_SELECTOR)).filter(element => {
        if (element.closest(SKIP_SELECTOR)) return false
        if (!(element.textContent || "").trim()) return false
        return !element.querySelector(UNIT_SELECTOR)
    })
}

// Replace inline elements with translatable placeholder tokens. Google
// Translate keeps the tokens intact while translating the whole paragraph.
function serializeUnit(element: Element): SerializedUnit {
    const tokens = new Map<number, Element>()
    const order: string[] = []
    let text = ""
    let hasText = false
    let nextId = 0

    const append = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const value = (node.textContent || "").replace(/\s+/g, " ")
            if (!value) return
            if (value.trim()) hasText = true
            text += value
            return
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return
        const child = node as Element
        const tag = child.tagName.toLowerCase()
        const id = nextId++
        tokens.set(id, child)
        if (
            SKIP_TAGS.has(tag) ||
            VOID_TAGS.has(tag) ||
            child.childNodes.length === 0
        ) {
            text += `[[v${id}]]`
            order.push(`v${id}`)
            return
        }
        text += `[[o${id}]]`
        order.push(`o${id}`)
        for (const nested of Array.from(child.childNodes)) append(nested)
        text += `[[c${id}]]`
        order.push(`c${id}`)
    }

    for (const child of Array.from(element.childNodes)) append(child)
    return { element, text: text.trim(), tokens, order }
}

function applyUnit(unit: SerializedUnit, translated: string): boolean {
    const tokenPattern = /\[\[([ocv])(\d+)\]\]/g
    const found: string[] = []
    let match: RegExpExecArray
    while ((match = tokenPattern.exec(translated))) {
        found.push(match[1] + match[2])
    }
    // Google Translate may reorder placeholders to match the target language's
    // word order, so only require that every token is present exactly once.
    const expected = new Set(unit.order)
    const seen = new Set<string>()
    for (const token of found) {
        if (!expected.has(token) || seen.has(token)) return false
        seen.add(token)
    }
    if (seen.size !== expected.size) return false

    const doc = unit.element.ownerDocument
    const fragment = doc.createDocumentFragment()
    const stack: { node: Node; id: number }[] = [{ node: fragment, id: -1 }]
    let lastIndex = 0
    tokenPattern.lastIndex = 0
    while ((match = tokenPattern.exec(translated))) {
        const between = translated.slice(lastIndex, match.index)
        if (between) {
            stack[stack.length - 1].node.appendChild(
                doc.createTextNode(between)
            )
        }
        const id = Number(match[2])
        const source = unit.tokens.get(id)
        if (!source) return false
        if (match[1] === "o") {
            const clone = source.cloneNode(false) as Element
            stack[stack.length - 1].node.appendChild(clone)
            stack.push({ node: clone, id })
        } else if (match[1] === "c") {
            if (stack.length <= 1 || stack[stack.length - 1].id !== id)
                return false
            stack.pop()
        } else {
            stack[stack.length - 1].node.appendChild(source.cloneNode(true))
        }
        lastIndex = tokenPattern.lastIndex
    }
    if (stack.length !== 1) return false
    const tail = translated.slice(lastIndex)
    if (tail) {
        stack[0].node.appendChild(doc.createTextNode(tail))
    }
    unit.element.textContent = ""
    unit.element.appendChild(fragment)
    return true
}

function insideUnit(node: Text, units: Set<Element>): boolean {
    let element = node.parentElement
    while (element) {
        if (units.has(element)) return true
        element = element.parentElement
    }
    return false
}

export async function translateArticle(
    html: string,
    title: string,
    target: string
): Promise<{ title: string; content: string }> {
    const dom = domParser.parseFromString(html, "text/html")
    const body = dom.body
    const unitElements = collectUnits(body)
    const unitSet = new Set(unitElements)
    const units = unitElements
        .map(serializeUnit)
        .filter(unit => Boolean(unit.text.trim()))

    // Translate any text that is not part of a block unit, such as text
    // directly inside a list item that also contains a nested list.
    const leftovers: TextRecord[] = []
    const walker = dom.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
        const node = walker.currentNode as Text
        if (node.parentElement?.closest(SKIP_SELECTOR)) continue
        if (insideUnit(node, unitSet)) continue
        const parts = splitWhitespace(node.textContent || "")
        if (!parts.core.trim()) continue
        leftovers.push({ node, ...parts })
    }

    const texts = [
        ...units.map(unit => unit.text),
        ...leftovers.map(r => r.core),
    ]
    const translateTitle = Boolean(title && title.trim())
    if (translateTitle) texts.unshift(title)
    if (texts.length === 0) return { title, content: html }

    const translated = await translateAll(texts, target)
    let index = translateTitle ? 1 : 0
    const failedUnits: SerializedUnit[] = []
    for (const unit of units) {
        if (!applyUnit(unit, translated[index++])) failedUnits.push(unit)
    }
    for (const record of leftovers) {
        const text = translated[index++]
        record.node.textContent = record.lead + text + record.trail
    }

    // If placeholders cannot be restored, translate the plain text instead of
    // leaving the paragraph in its original language.
    if (failedUnits.length > 0) {
        const plainTexts = failedUnits.map(unit =>
            unit.text.replace(/\[\[[ocv]\d+\]\]/g, "").trim()
        )
        const plainTranslated = await translateAll(plainTexts, target)
        failedUnits.forEach((unit, i) => {
            const text = plainTranslated[i]?.trim()
            if (text) unit.element.textContent = text
        })
    }

    return {
        title: translateTitle ? translated[0] || title : title,
        content: body.innerHTML,
    }
}
