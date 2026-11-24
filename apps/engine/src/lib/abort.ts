export function deadlineSignal(ms: number, parent?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(ms)
    return parent ? AbortSignal.any([parent, timeout]) : timeout
}

// Passing a signal to the AI SDK only helps when the provider underneath honours it. A call left
// pending with no socket and no timer behind it never hears the abort, so the caller stops waiting
// on its own and leaves the orphan to the garbage collector.
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

/** Whether the work ended, well or not, within `ms`. Past that nobody waits for it any more. */
export async function settledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), ms)
    })
    const settled = work.then(() => true, () => true)
    return Promise.race([settled, late]).finally(() => clearTimeout(timer))
}
