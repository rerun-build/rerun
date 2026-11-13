import { assertEngineEntitlement } from '@/app/api/_services/capacity.service'
import type { Database } from '@/app/api/database.types'
import { claimPoolEngine } from '@rerun/cloud/engines'
import { requestCompanyBrainSeed } from '@/lib/brain/request-seed'
import { buildBaseUrl } from '@/lib/engine/base-url'
import type { EngineConnection } from '@/lib/engine/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle, selectMaybeSingleWithJoins } from '@/supabase/supabase-helpers'
import { AppError, failure, type ActionFailure } from '@/lib/i18n/action-error'

// One workspace, one machine. The engine lives in `engine_pool`, claimed by a workspace, and every
// door onto it opens here: the Boxes drawn on the board are a way to arrange agents, not a way to
// address a machine.
//
// The key never leaves the server, and it never leaves this file's read either: `engine_pool` is
// service-role only, which is the reason the binding lives there rather than on `workspaces`.

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
    // False for an engine somebody else hosts, which Rerun can reach but not power on or off.
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

// Claims the workspace's machine, once. Not called when the workspace row is created: a
// workspace is minted for every anonymous visitor, and claiming there would drain the pool on bot
// traffic. It is called the first time the workspace needs a machine to put an agent on.
//
// An archived workspace only ever gets its machine back through the restore (`forRestore`): a box
// claimed by anything else would come up empty, and the restore would then set aside whatever had
// been put on it in the meantime.
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

    // A restored data-dir carries its own Company Brain.
    if (!forRestore) await requestCompanyBrainSeed(workspaceId, `brain-seed-${workspaceId}`)
    return { ok: true, instanceId: instance.id }
}

// The door that replaces the self-hosted Box: an engine somebody else runs, pinned to a workspace
// by hand from the admin. It has no provider server behind it, so the pool never tries to power
// it on, resize it or destroy it.
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

// The identity an engine proves when it calls back into the hub (webhooks, Hub MCP, the LLM proxy,
// embeddings): its RERUN_API_KEY, unique across the pool. An engine nobody claimed authenticates
// as nobody.
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
