import { open, seal } from './mobile-ticket'

const CONTEXT_KIND = 'oauth-context'
const CONTEXT_TTL_MS = 600_000
const SESSION_EXPIRED = 'Session expired, please retry'

type SealedContext<T> = { kind?: string; ctx: T; exp: number }

export function sealContext<T>(ctx: T): string {
    return seal({ kind: CONTEXT_KIND, ctx }, CONTEXT_TTL_MS)
}

function tryOpen<T>(raw: string): SealedContext<T> | null {
    try {
        return open<SealedContext<T>>(raw, 'sign-in context')
    } catch {
        return null
    }
}

export function openContext<T>(raw: string): T {
    const sealed = tryOpen<T>(raw)
    if (sealed?.kind !== CONTEXT_KIND) throw new Error(SESSION_EXPIRED)
    return sealed.ctx
}
