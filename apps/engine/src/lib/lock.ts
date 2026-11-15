const chains = new Map<string, Promise<unknown>>()

export function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve()
    const run = prev.then(() => fn())
    const tail = run.catch(() => {})
    chains.set(key, tail)
    tail.finally(() => {
        if (chains.get(key) === tail) chains.delete(key)
    })
    return run
}
