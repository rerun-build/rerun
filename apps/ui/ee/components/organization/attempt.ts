import type { Refusal } from '@/hooks/useErrorText'
import type { ErrorCode } from '@/lib/i18n/action-error'

import type { ConsoleResult } from './types'

// An action that never answers (offline, a server being replaced) is a refusal like another.
export async function attempt<Result extends ConsoleResult>(action: () => Promise<Result>): Promise<Result | ({ ok: false } & Refusal)> {
    try {
        return await action()
    } catch {
        return { ok: false, code: 'generic' satisfies ErrorCode }
    }
}

const STALE_CODES = new Set<string>(['notAuthenticated', 'notAuthorized', 'organizationOwnerOnly', 'organizationSuspended', 'workspaceNotFound'] satisfies ErrorCode[])

// What the page was drawn from is no longer true: signed out, off the team, suspended, a workspace gone.
export function isStale({ code }: Refusal): boolean {
    return !!code && STALE_CODES.has(code)
}
