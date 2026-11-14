import { assertSpaceAccess, spaceAccessMap, toVisibility, type AccessLevel, type Actor } from '@/app/api/_auth/access'
import { AuthorizationError, requireWorkspaceId } from '@/app/api/_auth/ownership'
import { findWorkspaceEngine, getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { buildBaseUrl } from '@/lib/engine/base-url'
import type { Database } from '@/app/api/database.types'
import type { EngineConnection } from '@/lib/engine/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle, selectSingle } from '@/supabase/supabase-helpers'
import type { Box } from '@rerun/contracts'

export { buildBaseUrl }

export async function getSpaceConnection(spaceId: string): Promise<EngineConnection> {
    const supabase = createServiceRoleClient()

    const { data: space } = await selectSingle(supabase, 'spaces', ['workspace_id'] as const, { id: spaceId })

    if (!space) {
        throw new Error('Box not found')
    }

    return getWorkspaceConnection(space.workspace_id)
}

export type SpaceTarget = { spaceId: string; conn: EngineConnection }

export async function resolveSpaceTarget(spaceId: string, workspaceId?: number): Promise<SpaceTarget> {
    const supabase = createServiceRoleClient()
    const [callerWorkspaceId, { data: space }] = await Promise.all([
        workspaceId ?? requireWorkspaceId(),
        selectMaybeSingle(supabase, 'spaces', ['workspace_id'] as const, { id: spaceId }),
    ])
    if (!space || space.workspace_id !== callerWorkspaceId) throw new AuthorizationError('boxNotFound')
    return { spaceId, conn: await getWorkspaceConnection(callerWorkspaceId) }
}

const BOX_COLUMNS = ['id', 'name', 'created_at', 'visibility'] as const

type BoxRow = Pick<Database['public']['Tables']['spaces']['Row'], (typeof BOX_COLUMNS)[number]>

function boxFromRow(row: BoxRow, managed: boolean, access: AccessLevel): Box {
    return { id: row.id, name: row.name, createdAt: row.created_at, managed, visibility: toVisibility(row.visibility), access }
}

export async function listBoxes(actor: Actor): Promise<Box[]> {
    const [{ data, error }, engine, accessBySpace] = await Promise.all([
        selectMany(createServiceRoleClient(), 'spaces', BOX_COLUMNS, { workspace_id: actor.workspaceId }, { column: 'created_at' }),
        findWorkspaceEngine(actor.workspaceId),
        spaceAccessMap(actor),
    ])
    if (error) throw error
    return (data ?? []).flatMap(row => {
        const access = accessBySpace.get(row.id) ?? 'none'
        return access === 'none' ? [] : [boxFromRow(row, !!engine?.managed, access)]
    })
}

export async function readBox(actor: Actor, spaceId: string): Promise<Box> {
    const { access } = await assertSpaceAccess(spaceId, 'use', actor)
    const [{ data, error }, engine] = await Promise.all([
        selectSingle(createServiceRoleClient(), 'spaces', BOX_COLUMNS, { id: spaceId }),
        findWorkspaceEngine(actor.workspaceId),
    ])
    if (error || !data || access === 'none') throw error ?? new AuthorizationError('boxNotFound')
    return boxFromRow(data, !!engine?.managed, access)
}
