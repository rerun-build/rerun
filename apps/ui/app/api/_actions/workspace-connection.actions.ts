'use server'

import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import {
    claudeKeysFromCode,
    codexKeysWhenApproved,
    createAiConnection,
    deleteAiConnection,
    getAiConnectionUsage,
    isOpencodeOfferedTo,
    listAiConnections,
    setWorkspaceDefaultModel,
    startClaudeSignIn,
    startCodexSignIn,
    updateAiConnection,
    updateAiConnectionKeys,
} from '@/app/api/_services/ai-connection.service'
import { NoPlanError } from '@/app/api/_services/capacity.service'
import type { ClaudeOAuthStart } from '@/lib/engine/claude-oauth'
import type { CodexDeviceAuthStart } from '@/lib/engine/codex-oauth'
import type { BoxConnection, BoxConnectionsList, BoxConnectionUsage, BoxDefault, CreateBoxConnectionInput, UpdateBoxConnectionInput } from '@/lib/engine/types'

// The AI providers of the workspace, for the web dialog. The workspace of the session is the whole
// scope, so these actions take no id at all; the logic is shared with the app in ai-connection.service.
//
// Server Actions cannot surface a thrown message in production (Next redacts it to a digest), so
// the mutations answer with a serializable result instead of throwing. A workspace with no engine
// yet reads as empty rather than as an error.

type Result = { success: true } | { success: false; error: string }

function failure(err: unknown, fallback: string): { success: false; error: string } {
    return { success: false, error: err instanceof Error ? err.message : fallback }
}

// `no_plan` lets the caller offer the trial instead of a dead end: without a plan there is no machine
// to hold a credential, whatever the user pastes.
type CreateResult = { success: true; connection: BoxConnection } | { success: false; error: string; reason?: 'no_plan' }

// `opencodeOffered`: whether this workspace may add OpenCode, behind its flag and on an engine that
// runs it.
export async function listAiConnectionsAction(): Promise<BoxConnectionsList & { opencodeOffered: boolean }> {
    try {
        const workspaceId = await requireWorkspaceId()
        const [list, opencodeOffered] = await Promise.all([listAiConnections(workspaceId), isOpencodeOfferedTo(workspaceId).catch(() => false)])
        return { ...list, opencodeOffered }
    } catch {
        return { connections: [], default: null, opencodeOffered: false }
    }
}

export async function setDefaultModelAction(pick: BoxDefault | null): Promise<Result> {
    try {
        await setWorkspaceDefaultModel(await requireWorkspaceId(), pick)
        return { success: true }
    } catch (err) {
        return failure(err, 'Failed to set the workspace default model')
    }
}

export async function createAiConnectionAction(params: CreateBoxConnectionInput): Promise<CreateResult> {
    try {
        return { success: true, connection: await createAiConnection(await requireWorkspaceId(), params) }
    } catch (err) {
        if (err instanceof NoPlanError) return { success: false, error: 'Start your free trial to connect your own Claude plan or API key.', reason: 'no_plan' }
        return failure(err, 'Failed to create the connection')
    }
}

export async function updateAiConnectionAction(id: string, patch: UpdateBoxConnectionInput): Promise<{ success: true; connection: BoxConnection } | { success: false; error: string }> {
    try {
        return { success: true, connection: await updateAiConnection(await requireWorkspaceId(), id, patch) }
    } catch (err) {
        return failure(err, 'Failed to update the connection')
    }
}

export async function updateAiConnectionKeysAction(id: string, body: { set?: Record<string, string>; remove?: string[] }): Promise<Result> {
    try {
        await updateAiConnectionKeys(await requireWorkspaceId(), id, body)
        return { success: true }
    } catch (err) {
        return failure(err, 'Failed to save the credential')
    }
}

export async function getAiConnectionUsageAction(id: string): Promise<BoxConnectionUsage> {
    try {
        return await getAiConnectionUsage(await requireWorkspaceId(), id)
    } catch {
        return { agents: [], automations: [], isBoxDefault: false }
    }
}

export async function deleteAiConnectionAction(id: string): Promise<{ success: true; released: BoxConnectionUsage } | { success: false; error: string }> {
    try {
        return { success: true, released: await deleteAiConnection(await requireWorkspaceId(), id) }
    } catch (err) {
        return failure(err, 'Failed to delete the connection')
    }
}

// The exchange returns the keys rather than persisting them: the caller either creates a
// connection with them or patches an existing one, and only it knows which.

export async function startClaudeOAuthAction(): Promise<ClaudeOAuthStart> {
    return startClaudeSignIn()
}

export async function exchangeClaudeSubscriptionAction(code: string, verifier: string, state: string): Promise<{ success: true; keys: Record<string, string> } | { success: false; error: string }> {
    try {
        return { success: true, keys: await claudeKeysFromCode(code, verifier, state) }
    } catch (err) {
        return failure(err, 'Token exchange failed')
    }
}

export async function startCodexDeviceAuthAction(): Promise<CodexDeviceAuthStart> {
    return startCodexSignIn()
}

export async function pollCodexDeviceAuthAction(deviceAuthId: string, userCode: string): Promise<{ status: 'pending' } | { status: 'ok'; keys: Record<string, string> } | { status: 'error'; error: string }> {
    try {
        const keys = await codexKeysWhenApproved(deviceAuthId, userCode)
        return keys ? { status: 'ok', keys } : { status: 'pending' }
    } catch (err) {
        return { status: 'error', error: err instanceof Error ? err.message : 'Device authorization failed' }
    }
}
