export type MessageTree = { [key: string]: string | MessageTree }

// Keys of a namespace that describe the strings for the translator and never reach a screen.
export const CONTEXT_KEY = '_context'

// A key missing from a pack falls back to its English source, so a half-translated pack still shows
// a whole screen.
export function mergeMessages<T extends MessageTree>(base: T, ...overlays: (MessageTree | undefined)[]): T {
    const out: MessageTree = { ...base }
    for (const overlay of overlays) {
        if (!overlay) continue
        for (const [key, value] of Object.entries(overlay)) {
            if (key === CONTEXT_KEY) continue
            const current = out[key]
            out[key] = typeof value === 'object' && typeof current === 'object' ? mergeMessages(current, value) : value
        }
    }
    return out as T
}

export function withoutContext<T extends MessageTree>(tree: T): T {
    const out: MessageTree = {}
    for (const [key, value] of Object.entries(tree)) {
        if (key === CONTEXT_KEY) continue
        out[key] = typeof value === 'object' ? withoutContext(value) : value
    }
    return out as T
}
