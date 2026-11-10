'use server'

import { requireAdminContext, requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { attachServerManually, createPairingToken, detachWorkspaceServer, readWorkspaceServer, ServerPairingError, type WorkspaceServer } from '@/app/api/_services/servers.service'
import { SERVERS_ENABLED } from '@rerun/cloud/servers'
import { failure, failureOf, type ActionFailure, type ErrorCode } from '@/lib/i18n/action-error'

type Result<T> = ({ ok: true } & T) | ActionFailure

const SERVERS_ADMIN_ONLY = 'adminOnlyServers' satisfies ErrorCode

function failed(error: unknown): ActionFailure {
    if (!(error instanceof ServerPairingError)) console.error('[servers]', error)
    return failureOf(error, 'somethingWentWrong')
}

export async function getWorkspaceServerAction(): Promise<Result<{ server: WorkspaceServer | null }>> {
    if (!SERVERS_ENABLED) return failure('serversManagedByCloud')
    try {
        const ctx = await requireWorkspaceContext()
        return { ok: true, server: await readWorkspaceServer(ctx.workspace.id) }
    } catch (error) {
        return failed(error)
    }
}

export async function createPairingTokenAction(): Promise<Result<{ token: string; expiresAt: string }>> {
    if (!SERVERS_ENABLED) return failure('serversManagedByCloud')
    try {
        const ctx = await requireAdminContext(SERVERS_ADMIN_ONLY)
        return { ok: true, ...(await createPairingToken(ctx.workspace.id, ctx.userId)) }
    } catch (error) {
        return failed(error)
    }
}

export async function attachServerManuallyAction(input: { url: string; apiKey: string }): Promise<Result<object>> {
    if (!SERVERS_ENABLED) return failure('serversManagedByCloud')
    if (!input.url.trim() || !input.apiKey.trim()) return failure('enterServerAddressAndKey')
    try {
        const ctx = await requireAdminContext(SERVERS_ADMIN_ONLY)
        await attachServerManually(ctx.workspace.id, input)
        return { ok: true }
    } catch (error) {
        return failed(error)
    }
}

export async function detachServerAction(): Promise<Result<object>> {
    if (!SERVERS_ENABLED) return failure('serversManagedByCloud')
    try {
        const ctx = await requireAdminContext(SERVERS_ADMIN_ONLY)
        await detachWorkspaceServer(ctx.workspace.id)
        return { ok: true }
    } catch (error) {
        return failed(error)
    }
}
