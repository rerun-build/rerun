export function isNetworkFailure(err: unknown): boolean {
    if (!(err instanceof Error)) return false
    if (err.name === 'TimeoutError') return true
    return err instanceof TypeError && err.message === 'fetch failed'
}

const SIGN_IN_SERVICE_UNREACHABLE = "Couldn't reach the sign-in service. Try again in a moment."

export function describeSignInError(err: unknown, fallback: string): string {
    if (isNetworkFailure(err)) return SIGN_IN_SERVICE_UNREACHABLE
    return err instanceof Error ? err.message : fallback
}
