import { BOX_MANAGE_ONLY, BOX_NOT_FOUND, COWORKER_NOT_FOUND, enforce, readSpaceAccess, type Actor } from '@/app/api/_auth/access'
import { AuthorizationError } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import {
    createAgent as engineCreateAgent,
    deleteAgent as engineDeleteAgent,
    duplicateAgent as engineDuplicateAgent,
    importAgentArchive,
    listSchedules,
    patchAgent as enginePatchAgent,
    updateSchedule,
} from '@/lib/engine/client'
import type { EngineAgentConfigPatch } from '@/lib/engine/types'
import { AGENT_SPAN, UNPLACED_COL, agentsOverlap, isPlaced } from '@/lib/board/iso'
import type { GridPosition } from '@/lib/board/types'
import { coworkerLanguageFor } from '@/app/api/_services/coworker-language.service'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectSingle } from '@/supabase/supabase-helpers'
import { sanitizeIdentifier } from '@/lib/utils'
import { duplicateAgentName } from '@/lib/copy-name'
import { PLAN_LIMIT_REASON, hasFreeAgentSlot } from './capacity.service'
import { getSpaceConnection } from './space.service'
import { AppError, failure, type ActionFailure } from '@/lib/i18n/action-error'

type CreateAgentParams = {
    name: string
    description?: string
    soulMd?: string
    installMd?: string
    actor: Actor
    workspaceId: number
    spaceId: string
    position?: GridPosition
    config?: Omit<EngineAgentConfigPatch, 'name' | 'displayName' | 'description'>
    handle?: string
    enabled?: boolean
}

export async function findFreeCellInSpace(supabase: ReturnType<typeof createServiceRoleClient>, spaceId: string): Promise<GridPosition | null> {
    const [cell] = await findFreeCellsInSpace(supabase, spaceId, 1)
    return cell ?? null
}

export async function findFreeCellsInSpace(supabase: ReturnType<typeof createServiceRoleClient>, spaceId: string, count: number): Promise<GridPosition[]> {
    const { data: space } = await selectSingle(supabase, 'spaces', ['col_start', 'row_start', 'col_end', 'row_end'] as const, { id: spaceId })
    if (!space) return []

    const colMin = Math.min(space.col_start, space.col_end)
    const colMax = Math.max(space.col_start, space.col_end)
    const rowMin = Math.min(space.row_start, space.row_end)
    const rowMax = Math.max(space.row_start, space.row_end)

    const { data: occupants } = await selectMany(supabase, 'agents', ['col', 'row'] as const, { space_id: spaceId })
    const anchors = (occupants ?? []).filter(a => isPlaced(a)).map(a => ({ col: a.col, row: a.row }))

    const cells: GridPosition[] = []
    for (let row = rowMin; row <= rowMax - (AGENT_SPAN - 1) && cells.length < count; row++) {
        for (let col = colMin; col <= colMax - (AGENT_SPAN - 1) && cells.length < count; col++) {
            if (anchors.some(o => agentsOverlap({ col, row }, o))) continue
            cells.push({ col, row })
            anchors.push({ col, row })
        }
    }

    return cells
}

export async function moveAgentToBox(agentId: string, spaceId: string, actor: Actor): Promise<{ ok: true; position: GridPosition } | ActionFailure> {
    const supabase = createServiceRoleClient()
    const { data: agent } = await selectSingle(supabase, 'agents', ['space_id', 'workspace_id'] as const, { id: agentId })
    if (!agent || agent.workspace_id !== actor.workspaceId) return failure(COWORKER_NOT_FOUND)
    if (agent.space_id === spaceId) return failure('coworkerAlreadyInBox')
    const [from, to] = await Promise.all([readSpaceAccess(actor, agent.space_id), readSpaceAccess(actor, spaceId)])
    if (from === 'none') return failure(COWORKER_NOT_FOUND)
    if (to === 'none') return failure(BOX_NOT_FOUND)
    if (from !== 'manage' || to !== 'manage') return failure(BOX_MANAGE_ONLY)

    const position = await findFreeCellInSpace(supabase, spaceId)
    if (!position) return failure('boxFull')

    const { error } = await supabase.from('agents').update<Database['public']['Tables']['agents']['Update']>({ space_id: spaceId, col: position.col, row: position.row }).eq('id', agentId)
    if (error) return { ok: false, error: `Failed to move agent: ${error.message}` }

    return { ok: true, position }
}

async function assertCanCreateIn(actor: Actor, workspaceId: number, spaceId: string): Promise<void> {
    if (actor.workspaceId !== workspaceId) throw new AuthorizationError(BOX_NOT_FOUND)
    enforce(await readSpaceAccess(actor, spaceId), 'manage', BOX_NOT_FOUND)
}

function allocateHandle(displayName: string, taken: Set<string>): string {
    const base = sanitizeIdentifier(displayName).replace(/^_+|_+$/g, '') || 'agent'
    let candidate = base
    for (let i = 2; taken.has(candidate); i++) candidate = `${base}_${i}`
    return candidate
}

export async function deriveUniqueHandle(supabase: ReturnType<typeof createServiceRoleClient>, workspaceId: number, displayName: string, excludeAgentId?: string): Promise<string> {
    const { data } = await selectMany(supabase, 'agents', ['id', 'handle'] as const, { workspace_id: workspaceId })
    const taken = new Set((data ?? []).filter(a => a.id !== excludeAgentId && a.handle).map(a => a.handle as string))
    return allocateHandle(displayName, taken)
}

export async function deriveUniqueHandles(supabase: ReturnType<typeof createServiceRoleClient>, workspaceId: number, displayNames: string[]): Promise<string[]> {
    const { data } = await selectMany(supabase, 'agents', ['handle'] as const, { workspace_id: workspaceId })
    const taken = new Set((data ?? []).filter(a => a.handle).map(a => a.handle as string))
    return displayNames.map(displayName => {
        const handle = allocateHandle(displayName, taken)
        taken.add(handle)
        return handle
    })
}

export async function createAgent(params: CreateAgentParams) {
    const { name, description, soulMd, installMd, workspaceId, spaceId, position, config } = params

    if (!name || !workspaceId || !spaceId) {
        throw new Error('name, workspaceId and spaceId are required')
    }
    await assertCanCreateIn(params.actor, workspaceId, spaceId)

    const enabled = params.enabled ?? (await hasFreeAgentSlot(workspaceId))

    const conn = await getSpaceConnection(spaceId)
    const supabase = createServiceRoleClient()
    const handle = params.handle ?? (await deriveUniqueHandle(supabase, workspaceId, name))

    const language = config?.language ?? (await coworkerLanguageFor(supabase, workspaceId))
    const detail = await engineCreateAgent(conn, {
        config: { ...config, name: handle, displayName: name, description: description || undefined, enabled, ...(language ? { language } : {}) },
        soul: soulMd || undefined,
        install: installMd || undefined,
    })

    const cell = position ?? (await findFreeCellInSpace(supabase, spaceId))
    const { data: agent, error } = await supabase
        .from('agents')
        .insert<Database['public']['Tables']['agents']['Insert']>({
            name,
            handle,
            description: description || null,
            engine_agent_id: detail.id,
            workspace_id: workspaceId,
            space_id: spaceId,
            col: cell ? cell.col : UNPLACED_COL,
            row: cell ? cell.row : UNPLACED_COL,
            disabled_at: enabled ? null : new Date().toISOString(),
            disabled_reason: enabled ? null : PLAN_LIMIT_REASON,
        })
        .select()
        .single()

    if (error || !agent) {
        await engineDeleteAgent(conn, detail.id).catch(() => {})
        throw new Error(`Failed to persist agent: ${error?.message ?? 'unknown error'}`)
    }

    return agent
}

type ImportAgentParams = {
    actor: Actor
    archive: Blob
    name: string
    handle: string
    workspaceId: number
    spaceId: string
    position?: GridPosition
    templateId?: string
}

export async function importAgent(params: ImportAgentParams) {
    const { archive, name, handle, workspaceId, spaceId, position, templateId } = params
    await assertCanCreateIn(params.actor, workspaceId, spaceId)

    const enabled = await hasFreeAgentSlot(workspaceId)

    const conn = await getSpaceConnection(spaceId)
    const supabase = createServiceRoleClient()

    const imported = await importAgentArchive(conn, archive, handle, name)
    await enginePatchAgent(conn, imported.id, { ...(enabled ? {} : { enabled: false }), language: await coworkerLanguageFor(supabase, workspaceId) })

    const cell = position ?? (await findFreeCellInSpace(supabase, spaceId))
    const { data: agent, error } = await supabase
        .from('agents')
        .insert<Database['public']['Tables']['agents']['Insert']>({
            name,
            handle,
            description: imported.description || null,
            engine_agent_id: imported.id,
            workspace_id: workspaceId,
            space_id: spaceId,
            template_id: templateId ?? null,
            col: cell ? cell.col : UNPLACED_COL,
            row: cell ? cell.row : UNPLACED_COL,
            disabled_at: enabled ? null : new Date().toISOString(),
            disabled_reason: enabled ? null : PLAN_LIMIT_REASON,
        })
        .select()
        .single()

    if (error || !agent) {
        await engineDeleteAgent(conn, imported.id).catch(() => {})
        throw new Error(`Failed to persist agent: ${error?.message ?? 'unknown error'}`)
    }

    if (!enabled) await pauseAgentSchedules(agent.id).catch(err => console.error('[activation] failed to pause the schedules of an imported agent', agent.id, err))

    return { agent, imported }
}

type DuplicateAgentParams = {
    actor: Actor
    agentRowId: string
    workspaceId: number
    spaceId: string
    position?: GridPosition
}

export type DuplicatedAgent = {
    agent: Database['public']['Tables']['agents']['Row']
    schedules: string[]
    triggers: string[]
}

function isMissingDuplicateRoute(err: unknown): boolean {
    return err instanceof Error && /failed: 404/.test(err.message) && !err.message.includes('agent not found')
}

export async function duplicateAgent(params: DuplicateAgentParams): Promise<DuplicatedAgent> {
    const { agentRowId, workspaceId, spaceId, position } = params

    const supabase = createServiceRoleClient()
    const { data: source } = await selectSingle(supabase, 'agents', ['name', 'space_id', 'engine_agent_id', 'description', 'template_id', 'workspace_id'] as const, { id: agentRowId })
    if (!source || source.workspace_id !== workspaceId || !source.engine_agent_id) throw new AppError(COWORKER_NOT_FOUND)
    enforce(await readSpaceAccess(params.actor, source.space_id), 'manage', COWORKER_NOT_FOUND)
    await assertCanCreateIn(params.actor, workspaceId, spaceId)
    const enabled = await hasFreeAgentSlot(workspaceId)
    const name = duplicateAgentName(source.name)
    const handle = await deriveUniqueHandle(supabase, workspaceId, name)
    const conn = await getSpaceConnection(spaceId)

    let copy
    try {
        copy = await engineDuplicateAgent(conn, source.engine_agent_id, { name: handle, displayName: name })
    } catch (err) {
        throw isMissingDuplicateRoute(err) ? new AppError('engineTooOldToDuplicate') : err
    }

    if (!enabled) await enginePatchAgent(conn, copy.id, { enabled: false })

    const cell = position ?? (await findFreeCellInSpace(supabase, spaceId))
    const { data: agent, error } = await supabase
        .from('agents')
        .insert<Database['public']['Tables']['agents']['Insert']>({
            name,
            handle,
            description: copy.description || source.description || null,
            engine_agent_id: copy.id,
            workspace_id: workspaceId,
            space_id: spaceId,
            template_id: source.template_id,
            col: cell ? cell.col : UNPLACED_COL,
            row: cell ? cell.row : UNPLACED_COL,
            disabled_at: enabled ? null : new Date().toISOString(),
            disabled_reason: enabled ? null : PLAN_LIMIT_REASON,
        })
        .select()
        .single()

    if (error || !agent) {
        await engineDeleteAgent(conn, copy.id).catch(() => {})
        throw new Error(`Failed to persist agent: ${error?.message ?? 'unknown error'}`)
    }

    if (!enabled) await pauseAgentSchedules(agent.id).catch(err => console.error('[activation] failed to pause the schedules of a duplicated agent', agent.id, err))

    return { agent, schedules: copy.schedules, triggers: copy.triggers }
}

export async function pauseAgentSchedules(id: string): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: agent } = await selectSingle(supabase, 'agents', ['engine_agent_id', 'space_id'] as const, { id })
    if (!agent?.engine_agent_id) return

    const conn = await getSpaceConnection(agent.space_id)
    const schedules = await listSchedules(conn, agent.engine_agent_id)
    const paused: string[] = []

    for (const schedule of schedules.filter(s => s.enabled)) {
        await updateSchedule(conn, agent.engine_agent_id, schedule.slug, { enabled: false })
        paused.push(schedule.slug)
    }

    await supabase.from('agents').update<Database['public']['Tables']['agents']['Update']>({ disabled_schedule_slugs: paused }).eq('id', id)
}

export async function resumeAgentSchedules(id: string): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: agent } = await selectSingle(supabase, 'agents', ['engine_agent_id', 'space_id', 'disabled_schedule_slugs'] as const, { id })
    if (!agent?.engine_agent_id || agent.disabled_schedule_slugs.length === 0) return

    const conn = await getSpaceConnection(agent.space_id)
    for (const slug of agent.disabled_schedule_slugs) {
        await updateSchedule(conn, agent.engine_agent_id, slug, { enabled: true })
    }

    await supabase.from('agents').update<Database['public']['Tables']['agents']['Update']>({ disabled_schedule_slugs: [] }).eq('id', id)
}

export async function renameAgent(id: string, newName: string) {
    const supabase = createServiceRoleClient()
    const { data: agent } = await selectSingle(supabase, 'agents', ['workspace_id', 'space_id', 'engine_agent_id', 'handle'] as const, { id })
    if (!agent) throw new AppError(COWORKER_NOT_FOUND)

    const handle = await deriveUniqueHandle(supabase, agent.workspace_id, newName, id)
    if (agent.engine_agent_id) {
        const conn = await getSpaceConnection(agent.space_id)
        await enginePatchAgent(conn, agent.engine_agent_id, { name: handle, displayName: newName })
    }

    const { error } = await supabase.from('agents').update<Database['public']['Tables']['agents']['Update']>({ name: newName, handle }).eq('id', id)
    if (error) throw new Error(`Failed to rename agent: ${error.message}`)

    return { name: newName, handle, handleChanged: handle !== agent.handle }
}

export async function changeAgentHandle(id: string, requestedHandle: string) {
    const supabase = createServiceRoleClient()
    const { data: agent } = await selectSingle(supabase, 'agents', ['workspace_id', 'space_id', 'engine_agent_id', 'name', 'handle'] as const, { id })
    if (!agent) throw new AppError(COWORKER_NOT_FOUND)

    const handle = sanitizeIdentifier(requestedHandle).replace(/^_+|_+$/g, '')
    if (!handle) throw new AppError('handleUnusable', { handle: requestedHandle })

    if (handle !== agent.handle) {
        const { data: siblings } = await selectMany(supabase, 'agents', ['id', 'handle'] as const, { workspace_id: agent.workspace_id })
        if ((siblings ?? []).some(sibling => sibling.id !== id && sibling.handle === handle)) {
            throw new AppError('handleTaken', { handle })
        }
    }

    if (agent.engine_agent_id) {
        const conn = await getSpaceConnection(agent.space_id)
        await enginePatchAgent(conn, agent.engine_agent_id, { name: handle })
    }

    const { error } = await supabase.from('agents').update<Database['public']['Tables']['agents']['Update']>({ handle }).eq('id', id)
    if (error) throw new Error(`Failed to change the handle: ${error.message}`)

    return { name: agent.name, handle }
}

export async function deleteAgent(id: string) {
    const supabase = createServiceRoleClient()

    const { data: agent } = await selectSingle(supabase, 'agents', ['engine_agent_id', 'space_id'] as const, { id })

    if (!agent) {
        throw new AppError(COWORKER_NOT_FOUND)
    }

    if (agent.engine_agent_id) {
        const conn = await getSpaceConnection(agent.space_id)
        await engineDeleteAgent(conn, agent.engine_agent_id).catch(() => {})
    }

    await supabase.from('agents').delete().eq('id', id)

    return { success: true }
}
