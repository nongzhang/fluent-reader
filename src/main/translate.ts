import { ipcMain, net } from "electron"

const TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single"
// Keep each upstream request well below Google's URL length limit.
const MAX_QUERY_LENGTH = 4000
const MAX_TEXTS_PER_REQUEST = 60

function prepareText(text: string) {
    return text.replace(/\r?\n+/g, " ").trim()
}

function baseLanguage(language: string) {
    return language.toLowerCase().replace("_", "-").split("-")[0]
}

function isSameLanguage(source: string, target: string) {
    const normalizedSource = source.toLowerCase().replace("_", "-")
    const normalizedTarget = target.toLowerCase().replace("_", "-")
    if (normalizedSource === normalizedTarget) return true
    const sourceBase = baseLanguage(source)
    // Chinese and Portuguese variants differ meaningfully, so translate them.
    if (sourceBase === "zh" || sourceBase === "pt") return false
    return sourceBase === baseLanguage(target)
}

async function translateBatch(
    texts: string[],
    target: string
): Promise<string[]> {
    const prepared = texts.map(prepareText)
    const query = prepared.join("\n\n")
    const url =
        `${TRANSLATE_ENDPOINT}?client=gtx&sl=auto&dt=t` +
        `&tl=${encodeURIComponent(target)}&q=${encodeURIComponent(query)}`
    const response = await net.fetch(url, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) {
        throw new Error(`Google Translate returned ${response.status}`)
    }
    const data = await response.json()
    if (typeof data?.[2] === "string" && isSameLanguage(data[2], target)) {
        return texts
    }
    const segments = Array.isArray(data?.[0]) ? data[0] : []
    const translated = segments
        .map(segment => (Array.isArray(segment) ? segment[0] || "" : ""))
        .join("")
    if (texts.length === 1) {
        return [translated.trim() || prepared[0]]
    }
    const paragraphs = translated.split(/\n{2,}/).map(part => part.trim())
    if (paragraphs.length === texts.length) return paragraphs
    const lines = translated.split(/\n+/).map(part => part.trim())
    if (lines.length === texts.length) return lines
    // Translations cannot be mapped back to the inputs reliably.
    throw new Error("Could not align translated text with its inputs")
}

function splitIntoChunks(texts: string[]): string[][] {
    const chunks: string[][] = []
    let current: string[] = []
    let length = 0
    for (const text of texts) {
        const nextLength = prepareText(text).length + 2
        if (
            current.length > 0 &&
            (current.length >= MAX_TEXTS_PER_REQUEST ||
                length + nextLength > MAX_QUERY_LENGTH)
        ) {
            chunks.push(current)
            current = []
            length = 0
        }
        current.push(text)
        length += nextLength
    }
    if (current.length > 0) chunks.push(current)
    return chunks
}

export function setTranslateListeners() {
    ipcMain.handle(
        "translate-texts",
        async (_, texts: string[], target: string): Promise<string[]> => {
            if (!Array.isArray(texts) || texts.length === 0) return []
            if (
                typeof target !== "string" ||
                !/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/.test(target)
            ) {
                return texts
            }
            const results = new Array<string>(texts.length)
            let start = 0
            for (const chunk of splitIntoChunks(texts)) {
                try {
                    const translated = await translateBatch(chunk, target)
                    for (let i = 0; i < chunk.length; i++) {
                        results[start + i] = translated[i] || chunk[i]
                    }
                } catch (err) {
                    console.log("Translation failed:", err)
                    for (let i = 0; i < chunk.length; i++) {
                        results[start + i] = chunk[i]
                    }
                }
                start += chunk.length
            }
            return results
        }
    )
}
