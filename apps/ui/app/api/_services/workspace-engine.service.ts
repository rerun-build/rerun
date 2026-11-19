import { assertEngineEntitlement } from '@/app/api/_services/capacity.service'
import { pushBoxPlan } from '@/app/api/_services/engine-plan.service'
import type { Database } from '@/app/api/database.types'
import { claimPoolEngine } from '@moldwright/cloud/engines'
import { requestCompanyBrainSeed } from '@/lib/brain/request-seed'
import { buildBaseUrl } from '@/lib/engine/base-url'
import type { EngineConnection } from '@/lib/engine/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle, selectMaybeSingleWithJoins } from '@/supabase/supabase-helpers'
import { AppError, failure, type ActionFailure } from '@/lib/i18n/action-error'

const ENGINE_COLUMNS = ['id', 'engine_host', 'engine_api_key', 'provider_server_id'] as const

export class NoEngineError extends AppError {
    constructor() {
        super('noMachineYet')
        this.name = 'NoEngineError'
    }
}

export type WorkspaceEngine = {
    instanceId: string
    conn: EngineConnection
    managed: boolean
}

export async function findWorkspaceEngine(workspaceId: number): Promise<WorkspaceEngine | null> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'engine_pool', ENGINE_COLUMNS, { claimed_by_workspace_id: workspaceId })
    if (!data?.engine_host) return null
    return {
        instanceId: data.id,
        conn: { baseUrl: buildBaseUrl(data.engine_host), apiKey: data.engine_api_key },
        managed: !!data.provider_server_id,
    }
}

export async function getWorkspaceConnection(workspaceId: number): Promise<EngineConnection> {
    const engine = await findWorkspaceEngine(workspaceId)
    if (!engine) throw new NoEngineError()
    return engine.conn
}

export async function ensureWorkspaceEngine(workspaceId: number, { forRestore = false }: { forRestore?: boolean } = {}): Promise<{ ok: true; instanceId: string } | ActionFailure> {
    const existing = await findWorkspaceEngine(workspaceId)
    if (existing) return { ok: true, instanceId: existing.instanceId }

    if (!forRestore) {
        const { data: workspace } = await selectMaybeSingle(createServiceRoleClient(), 'workspaces', ['boxes_archived_at'] as const, { id: workspaceId })
        if (workspace?.boxes_archived_at) return failure('workspaceRestoring')
    }

    await assertEngineEntitlement(workspaceId)

    const claim = await claimPoolEngine(workspaceId)
    if (!claim.ok) {
        if (!claim.raced) return { ok: false, error: claim.error }
        const winner = await findWorkspaceEngine(workspaceId)
        return winner ? { ok: true, instanceId: winner.instanceId } : { ok: false, error: claim.error }
    }
    const { instance } = claim

    if (!forRestore) await requestCompanyBrainSeed(workspaceId, `brain-seed-${workspaceId}`)
    await pushBoxPlan(workspaceId, { baseUrl: buildBaseUrl(instance.engineHost), apiKey: instance.engineApiKey })
    return { ok: true, instanceId: instance.id }
}

export async function syncEnginePlan(workspaceId: number): Promise<void> {
    try {
        const engine = await findWorkspaceEngine(workspaceId)
        if (engine) await pushBoxPlan(workspaceId, engine.conn)
    } catch (err) {
        console.error(`[plan] failed to sync the plan of workspace ${workspaceId}`, err)
    }
}

export async function attachCustomEngine(workspaceId: number, params: { engineHost: string; engineApiKey: string }): Promise<void> {
    const supabase = createServiceRoleClient()
    const existing = await findWorkspaceEngine(workspaceId)
    if (existing) throw new Error('This workspace already has an engine. Detach it first.')

    const { error } = await supabase.from('engine_pool').insert<Database['public']['Tables']['engine_pool']['Insert']>({
        provider: 'incus',
        provider_server_id: null,
        engine_host: params.engineHost,
        engine_api_key: params.engineApiKey,
        status: 'claimed',
        claimed_by_workspace_id: workspaceId,
    })
    if (error) throw new Error(error.message)
}

export type AuthenticatedWorkspace = { workspaceId: number; isSandbox: boolean }

export async function authenticateEngineToken(token: string): Promise<AuthenticatedWorkspace | null> {
    if (!token) return null
    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingleWithJoins(
        supabase,
        'engine_pool',
        ['claimed_by_workspace_id'] as const,
        { workspace: { table: 'workspaces', foreignKey: 'workspaces', columns: ['id', 'is_sandbox'] } as const },
        { engine_api_key: token },
    )
    if (!data?.claimed_by_workspace_id || !data.workspace) return null
    return { workspaceId: data.workspace.id, isSandbox: data.workspace.is_sandbox }
}
