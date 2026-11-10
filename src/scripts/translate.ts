import type { AnyAction } from "redux"
import type { ThunkDispatch } from "redux-thunk"
import type { RootState } from "./reducer"
import type { AppThunk } from "./utils"
import { TRANSLATIONS_RECEIVED } from "./models/app"

type TranslationField = "title" | "snippet"
type QueueDispatch = ThunkDispatch<RootState, unknown, AnyAction>

type QueueEntry = {
    key: string
    text: string
    target: string
    dispatch: QueueDispatch
}

const MAX_QUERY_LENGTH = 3500
const MAX_TEXTS_PER_REQUEST = 20
const MAX_CONCURRENT_REQUESTS = 3

const pendingKeys = new Set<string>()
let queue: QueueEntry[] = []
let flushTimer: ReturnType<typeof setTimeout> = null

export function resolveTranslationTarget(
    setting: string,
    locale: string
): string {
    if (setting === "none") return null
    return setting && setting !== "default" ? setting : locale
}

export function translationKey(
    target: string,
    itemId: number,
    field: TranslationField
): string {
    return `${target}\u0000${itemId}\u0000${field}`
}

export function requestTranslation(
    itemId: number,
    text: string,
    field: TranslationField
): AppThunk {
    return (dispatch, getState) => {
        const state = getState()
        const target = resolveTranslationTarget(
            state.app.translateTarget,
            state.app.locale
        )
        if (!target || !text || !text.trim()) return
        const key = translationKey(target, itemId, field)
        if (state.app.translations[key] || pendingKeys.has(key)) return
        pendingKeys.add(key)
        queue.push({ key, text, target, dispatch })
        if (!flushTimer) flushTimer = setTimeout(flushQueue, 50)
    }
}

function splitIntoChunks(entries: QueueEntry[]): QueueEntry[][] {
    const chunks: QueueEntry[][] = []
    let current: QueueEntry[] = []
    let length = 0
    for (const entry of entries) {
        const nextLength = entry.text.length + 2
        if (
            current.length > 0 &&
            (current.length >= MAX_TEXTS_PER_REQUEST ||
                length + nextLength > MAX_QUERY_LENGTH)
        ) {
            chunks.push(current)
            current = []
            length = 0
        }
        current.push(entry)
        length += nextLength
    }
    if (current.length > 0) chunks.push(current)
    return chunks
}

async function translateChunk(target: string, chunk: QueueEntry[]) {
    try {
        const translated = await globalThis.translate.translateTexts(
            chunk.map(entry => entry.text),
            target
        )
        const translations: Record<string, string> = {}
        chunk.forEach((entry, index) => {
            pendingKeys.delete(entry.key)
            const text = translated?.[index]
            if (typeof text === "string" && text.trim()) {
                translations[entry.key] = text
            }
        })
        if (Object.keys(translations).length > 0) {
            chunk[0].dispatch({
                type: TRANSLATIONS_RECEIVED,
                translations,
            })
        }
    } catch (err) {
        console.log("Translation failed:", err)
        chunk.forEach(entry => pendingKeys.delete(entry.key))
    }
}

async function flushQueue() {
    flushTimer = null
    const entries = queue
    queue = []
    if (entries.length === 0) return

    const groups = new Map<string, QueueEntry[]>()
    for (const entry of entries) {
        const group = groups.get(entry.target)
        if (group) group.push(entry)
        else groups.set(entry.target, [entry])
    }

    const chunks: [string, QueueEntry[]][] = []
    for (const [target, group] of groups) {
        for (const chunk of splitIntoChunks(group)) {
            chunks.push([target, chunk])
        }
    }

    let next = 0
    const worker = async () => {
        while (next < chunks.length) {
            const [target, chunk] = chunks[next++]
            await translateChunk(target, chunk)
        }
    }
    const workerCount = Math.min(MAX_CONCURRENT_REQUESTS, chunks.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
}
