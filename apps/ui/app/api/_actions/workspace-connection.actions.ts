'use server'

import { requireAdminContext, requireWorkspaceId } from '@/app/api/_auth/ownership'
import {
    claudeKeysFromCode,
    codexKeysWhenApproved,
    createAiConnection,
    deleteAiConnection,
    getAiConnectionUsage,
    isCustomOfferedTo,
    isOpencodeOfferedTo,
    listAiConnections,
    probeCustomEndpoint,
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
import { customProbeInputSchema, type CustomProbeInput, type CustomProbeResult } from '@moldwright/contracts'
import { refusal, refusalOf, type ActionRefusal, type ErrorCode } from '@/lib/i18n/action-error'

type Refusal = { success: false } & ActionRefusal
type Result = { success: true } | Refusal

async function requireProvidersAdminWorkspaceId(): Promise<number> {
    return (await requireAdminContext('adminOnlyAiProviders')).workspace.id
}

function refused(err: unknown, fallback: ErrorCode): Refusal {
    return { success: false, ...refusalOf(err, fallback) }
}

function refusedNoPlan(code: ErrorCode): Refusal & { reason: 'no_plan' } {
    return { success: false, ...refusal(code), reason: 'no_plan' }
}

type CreateResult = { success: true; connection: BoxConnection } | (Refusal & { reason?: 'no_plan' })

type AiConnectionsList = BoxConnectionsList & { opencodeOffered: boolean; customOffered: boolean }

async function readAiConnections(): Promise<AiConnectionsList> {
    const workspaceId = await requireWorkspaceId()
    const [list, opencodeOffered, customOffered] = await Promise.all([listAiConnections(workspaceId), isOpencodeOfferedTo(workspaceId).catch(() => false), isCustomOfferedTo(workspaceId).catch(() => false)])
    return { ...list, opencodeOffered, customOffered }
}

export async function listAiConnectionsAction(): Promise<AiConnectionsList> {
    try {
        return await readAiConnections()
    } catch {
        return { connections: [], default: null, opencodeOffered: false, customOffered: false }
    }
}

export async function refreshAiConnectionsAction(): Promise<AiConnectionsList | null> {
    try {
        return await readAiConnections()
    } catch {
        return null
    }
}

export async function probeCustomEndpointAction(input: CustomProbeInput): Promise<{ success: true; result: CustomProbeResult } | (Refusal & { reason?: 'no_plan' })> {
    try {
        return { success: true, result: await probeCustomEndpoint(await requireWorkspaceId(), customProbeInputSchema.parse(input)) }
    } catch (err) {
        if (err instanceof NoPlanError) return refusedNoPlan('trialToConnectModel')
        return refused(err, 'endpointUnreachable')
    }
}

export async function setDefaultModelAction(pick: BoxDefault | null): Promise<Result> {
    try {
        await setWorkspaceDefaultModel(await requireProvidersAdminWorkspaceId(), pick)
        return { success: true }
    } catch (err) {
        return refused(err, 'setDefaultModelFailed')
    }
}

export async function createAiConnectionAction(params: CreateBoxConnectionInput): Promise<CreateResult> {
    try {
        return { success: true, connection: await createAiConnection(await requireProvidersAdminWorkspaceId(), params) }
    } catch (err) {
        if (err instanceof NoPlanError) return refusedNoPlan('trialToConnectClaude')
        return refused(err, 'createConnectionFailed')
    }
}

export async function updateAiConnectionAction(id: string, patch: UpdateBoxConnectionInput): Promise<{ success: true; connection: BoxConnection } | Refusal> {
    try {
        return { success: true, connection: await updateAiConnection(await requireProvidersAdminWorkspaceId(), id, patch) }
    } catch (err) {
        return refused(err, 'updateConnectionFailed')
    }
}

export async function updateAiConnectionKeysAction(id: string, body: { set?: Record<string, string>; remove?: string[] }): Promise<Result> {
    try {
        await updateAiConnectionKeys(await requireProvidersAdminWorkspaceId(), id, body)
        return { success: true }
    } catch (err) {
        return refused(err, 'saveCredentialFailed')
    }
}

export async function getAiConnectionUsageAction(id: string): Promise<BoxConnectionUsage> {
    try {
        return await getAiConnectionUsage(await requireWorkspaceId(), id)
    } catch {
        return { agents: [], automations: [], isBoxDefault: false }
    }
}

export async function deleteAiConnectionAction(id: string): Promise<{ success: true; released: BoxConnectionUsage } | Refusal> {
    try {
        return { success: true, released: await deleteAiConnection(await requireProvidersAdminWorkspaceId(), id) }
    } catch (err) {
        return refused(err, 'deleteConnectionFailed')
    }
}

export async function startClaudeOAuthAction(): Promise<ClaudeOAuthStart> {
    return startClaudeSignIn()
}

export async function exchangeClaudeSubscriptionAction(code: string, verifier: string, state: string): Promise<{ success: true; keys: Record<string, string> } | Refusal> {
    try {
        return { success: true, keys: await claudeKeysFromCode(code, verifier, state) }
    } catch (err) {
        return refused(err, 'tokenExchangeFailed')
    }
}

export async function startCodexDeviceAuthAction(): Promise<CodexDeviceAuthStart> {
    return startCodexSignIn()
}

export async function pollCodexDeviceAuthAction(deviceAuthId: string, userCode: string): Promise<{ status: 'pending' } | { status: 'ok'; keys: Record<string, string> } | ({ status: 'error' } & ActionRefusal)> {
    try {
        const keys = await codexKeysWhenApproved(deviceAuthId, userCode)
        return keys ? { status: 'ok', keys } : { status: 'pending' }
    } catch (err) {
        return { status: 'error', ...refusalOf(err, 'deviceAuthFailed') }
    }
}
