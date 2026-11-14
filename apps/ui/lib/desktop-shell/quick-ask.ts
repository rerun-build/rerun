export const QUICK_ASK_STORAGE_KEY = 'rerun:quick-ask'
export const QUICK_ASK_MAX_LENGTH = 4000
const FRESH_MS = 60_000

export function handOverQuickAsk(text: string): void {
    localStorage.setItem(QUICK_ASK_STORAGE_KEY, JSON.stringify({ text: text.slice(0, QUICK_ASK_MAX_LENGTH), at: Date.now() }))
}

export function takeQuickAsk(): string | null {
    let raw: string | null = null
    try {
        raw = localStorage.getItem(QUICK_ASK_STORAGE_KEY)
        if (raw) localStorage.removeItem(QUICK_ASK_STORAGE_KEY)
    } catch {
        return null
    }
    if (!raw) return null
    try {
        const { text, at } = JSON.parse(raw) as { text?: unknown; at?: unknown }
        if (typeof text !== 'string' || !text.trim() || typeof at !== 'number' || Date.now() - at > FRESH_MS) return null
        return text.slice(0, QUICK_ASK_MAX_LENGTH)
    } catch {
        return null
    }
}
