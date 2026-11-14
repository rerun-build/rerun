export function deadlineSignal(ms: number, parent?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(ms)
    return parent ? AbortSignal.any([parent, timeout]) : timeout
}

export function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        work.catch(() => {})
        return Promise.reject(signal.reason)
    }
    let onAbort: () => void = () => {}
    const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
    })
    return Promise.race([work, aborted]).finally(() => signal.removeEventListener('abort', onAbort))
}
