export const SIGNUP_STAMP_RETRY_DELAYS_MS: readonly number[] = [2_000, 3_000, 5_000, 10_000, 10_000, 10_000, 10_000, 10_000]

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted) return resolve()
        const timer = setTimeout(done, ms)
        signal.addEventListener('abort', done, { once: true })
        function done() {
            clearTimeout(timer)
            signal.removeEventListener('abort', done)
            resolve()
        }
    })
}

export async function awaitSignupStamp(read: () => Promise<string | null>, signal: AbortSignal, delays = SIGNUP_STAMP_RETRY_DELAYS_MS): Promise<string | null> {
    for (const delay of delays) {
        await sleep(delay, signal)
        if (signal.aborted) return null
        const stamp = await read().catch(() => null)
        if (signal.aborted) return null
        if (stamp) return stamp
    }
    return null
}
