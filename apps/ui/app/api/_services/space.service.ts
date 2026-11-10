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

// A Box no longer holds a machine: the workspace does. These keep their names and their
// signatures so the agent-scoped callers that start from a `space_id` column do not move, but what
// they resolve is the workspace's one engine.
export async function getSpaceConnection(spaceId: string): Promise<EngineConnection> {
    const supabase = createServiceRoleClient()

    const { data: space } = await selectSingle(supabase, 'spaces', ['workspace_id'] as const, { id: spaceId })

    if (!space) {
        throw new Error('Box not found')
    }

    return getWorkspaceConnection(space.workspace_id)
}

export type SpaceTarget = { spaceId: string; conn: EngineConnection }

// The door of the two public contracts that still address a Box by its id: the REST route
// /api/v1/boxes/[id]/* and the space tools of the MCP server. It both proves the Box belongs to the
// caller and hands back the connection, so neither has to pair an assertion with a separate
// unchecked fetch. Inside the app a server action has no Box to name: it goes through
// requireWorkspaceConnection. `workspaceId` is passed in when the caller proved its identity with
// an API key rather than a browser session; omitted, it comes from the session.
export async function resolveSpaceTarget(spaceId: string, workspaceId?: number): Promise<SpaceTarget> {
    const supabase = createServiceRoleClient()
    const [callerWorkspaceId, { data: space }] = await Promise.all([
        workspaceId ?? requireWorkspaceId(),
        selectMaybeSingle(supabase, 'spaces', ['workspace_id'] as const, { id: spaceId }),
    ])
    if (!space || space.workspace_id !== callerWorkspaceId) throw new AuthorizationError('boxNotFound')
    return { spaceId, conn: await getWorkspaceConnection(callerWorkspaceId) }
}

// A Box read carries only what a Box is: a name, a rectangle's identity, who sees it and the
// caller's level on it. `managed` describes the machine the whole workspace runs on, kept on the
// public /api/v1/boxes contract that the mobile app still reads.
const BOX_COLUMNS = ['id', 'name', 'created_at', 'visibility'] as const

type BoxRow = Pick<Database['public']['Tables']['spaces']['Row'], (typeof BOX_COLUMNS)[number]>

function boxFromRow(row: BoxRow, managed: boolean, access: AccessLevel): Box {
    return { id: row.id, name: row.name, createdAt: row.created_at, managed, visibility: toVisibility(row.visibility), access }
}

// The Boxes the actor reaches, a Box closed to it left out.
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
