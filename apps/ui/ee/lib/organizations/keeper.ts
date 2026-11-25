// What every request, email, push, published page and coworker tool asks about an organization, and
// that changes a few times in its life: kept for a moment, in this process only.
const KEPT_MS = 30_000
const MAX_KEPT = 5_000

export function keeper<Key, Value>(read: (key: Key) => Promise<Value>) {
    const kept = new Map<Key, { value: Value; until: number }>()
    return {
        forget: () => kept.clear(),
        get: async (key: Key): Promise<Value> => {
            const known = kept.get(key)
            if (known && known.until > Date.now()) return known.value
            const value = await read(key)
            if (kept.size >= MAX_KEPT) kept.clear()
            kept.set(key, { value, until: Date.now() + KEPT_MS })
            return value
        },
    }
}
