const FALLBACK_HEADER = 'X-Og-Fallback'

export async function warmImage(url: string, timeoutMs: number): Promise<boolean> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
        if (!res.ok || res.headers.get(FALLBACK_HEADER)) return false
        await res.arrayBuffer()
        return true
    } catch (error) {
        console.error('[og] warm-up failed', url, error)
        return false
    }
}
