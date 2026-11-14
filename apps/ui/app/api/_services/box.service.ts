import { BOX_NOT_FOUND, assertSpaceAccess, isAdminActor, type Actor } from '@/app/api/_auth/access'
import { ensureWorkspaceNamed, resolveBoxName } from '@/app/api/_services/naming.service'
import { ensureWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import type { Database } from '@/app/api/database.types'
import { findRadialRect, rectOnSide, type SpaceSide } from '@/lib/board/space-layout'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectCount, selectMany } from '@/supabase/supabase-helpers'
import { AppError, failure, failureOf, type ActionFailure } from '@/lib/i18n/action-error'

const SPACE_RECT_COLUMNS = ['id', 'name', 'col_start', 'row_start', 'col_end', 'row_end'] as const

const OLDEST_FIRST = { column: 'created_at', ascending: true } as const

export type ClaimedBox = { ok: true; spaceId: string; name: string; colStart: number; rowStart: number; colEnd: number; rowEnd: number } | ActionFailure

function takenNames(spaces: { name: string | null }[] | null): string[] {
    return (spaces ?? []).map(space => space.name ?? '').filter(Boolean)
}

async function grantCreatorManage(actor: Actor, spaceIds: string[]): Promise<void> {
    if (isAdminActor(actor) || actor.kind !== 'user' || !spaceIds.length) return
    const rows = spaceIds.map(spaceId => ({ space_id: spaceId, user_id: actor.userId, workspace_id: actor.workspaceId, access: 'manage', granted_by: actor.userId }))
    const { error } = await createServiceRoleClient().from('space_members').upsert<Database['public']['Tables']['space_members']['Insert']>(rows, { onConflict: 'space_id,user_id' })
    if (error) throw new Error(`Failed to give you access to the Box: ${error.message}`)
}

export async function createBox(params: { workspaceId: number; userId: string; actor: Actor; name?: string | null; from?: { spaceId: string; side: SpaceSide } }): Promise<ClaimedBox> {
    const { workspaceId, userId, actor } = params
    if (actor.workspaceId !== workspaceId) return failure('boxNotInWorkspace')

    if (params.from) {
        try {
            await assertSpaceAccess(params.from.spaceId, 'use', actor)
        } catch (err) {
            return failureOf(err, BOX_NOT_FOUND)
        }
    }

    const engine = await ensureWorkspaceEngine(workspaceId).catch(err => failureOf(err, 'noActivePlan'))
    if (!engine.ok) return engine

    const supabase = createServiceRoleClient()

    const { data: spaces } = await selectMany(supabase, 'spaces', SPACE_RECT_COLUMNS, { workspace_id: workspaceId }, OLDEST_FIRST)
    const from = params.from
    const source = from ? spaces?.find(s => s.id === from.spaceId) : undefined
    const rect = source && from ? rectOnSide(source, from.side, spaces ?? []) : findRadialRect(spaces ?? [])
    const name = await resolveBoxName({ workspaceId, taken: takenNames(spaces), proposed: params.name })

    const { data, error } = await supabase
        .from('spaces')
        .insert<Database['public']['Tables']['spaces']['Insert']>({
            workspace_id: workspaceId,
            col_start: rect.colStart,
            row_start: rect.rowStart,
            col_end: rect.colEnd,
            row_end: rect.rowEnd,
            name,
        })
        .select('id')
        .single()

    if (error) return { ok: false, error: error.message }
    const spaceId = (data as { id: string }).id
    try {
        await grantCreatorManage(actor, [spaceId])
    } catch (err) {
        await supabase.from('spaces').delete().eq('id', spaceId)
        return failureOf(err, 'boxCreateFailed')
    }

    await ensureWorkspaceNamed({ workspaceId, userId })
    return { ok: true, spaceId, name, colStart: rect.colStart, rowStart: rect.rowStart, colEnd: rect.colEnd, rowEnd: rect.rowEnd }
}

export async function createBoxes(params: { workspaceId: number; userId: string; actor: Actor; names: string[] }): Promise<ClaimedBox[]> {
    const results: ClaimedBox[] = []
    for (const name of params.names) {
        results.push(await createBox({ workspaceId: params.workspaceId, userId: params.userId, actor: params.actor, name }))
    }
    return results
}

export async function createBoxesBatch(params: { workspaceId: number; userId: string; actor: Actor; names: string[] }): Promise<ClaimedBox[]> {
    const { workspaceId, userId, actor, names } = params
    if (!names.length) return []
    if (actor.workspaceId !== workspaceId) return names.map(() => failure('boxNotInWorkspace'))

    const engine = await ensureWorkspaceEngine(workspaceId).catch(err => failureOf(err, 'noActivePlan'))
    if (!engine.ok) return names.map(() => engine)

    const supabase = createServiceRoleClient()
    const { data: existing } = await selectMany(supabase, 'spaces', SPACE_RECT_COLUMNS, { workspace_id: workspaceId }, OLDEST_FIRST)
    const placed: { name: string | null; col_start: number; row_start: number; col_end: number; row_end: number }[] = [...(existing ?? [])]

    const rows: Database['public']['Tables']['spaces']['Insert'][] = []
    for (const proposed of names) {
        const rect = findRadialRect(placed)
        const name = await resolveBoxName({ workspaceId, taken: takenNames(placed), proposed })
        placed.push({ name, col_start: rect.colStart, row_start: rect.rowStart, col_end: rect.colEnd, row_end: rect.rowEnd })
        rows.push({ workspace_id: workspaceId, name, col_start: rect.colStart, row_start: rect.rowStart, col_end: rect.colEnd, row_end: rect.rowEnd })
    }

    const { data, error } = await supabase.from('spaces').insert<Database['public']['Tables']['spaces']['Insert']>(rows).select('id, name, col_start, row_start, col_end, row_end')
    if (error || !data) return names.map(() => (error ? { ok: false as const, error: error.message } : failure('boxesCreateFailed')))
    try {
        await grantCreatorManage(actor, data.map(space => space.id))
    } catch (err) {
        await supabase.from('spaces').delete().in('id', data.map(space => space.id))
        return names.map(() => failureOf(err, 'boxesCreateFailed'))
    }

    await ensureWorkspaceNamed({ workspaceId, userId })

    return rows.map(row => {
        const created = data.find(space => space.col_start === row.col_start && space.row_start === row.row_start)
        if (!created) return failure('boxCreateFailed')
        return { ok: true as const, spaceId: created.id, name: created.name ?? row.name ?? '', colStart: created.col_start, rowStart: created.row_start, colEnd: created.col_end, rowEnd: created.row_end }
    })
}

export async function renameBox(actor: Actor, spaceId: string, newName: string): Promise<void> {
    await assertSpaceAccess(spaceId, 'manage', actor)
    const supabase = createServiceRoleClient()
    const { error } = await supabase.from('spaces').update<Database['public']['Tables']['spaces']['Update']>({ name: newName }).eq('id', spaceId)
    if (error) throw new Error(`Failed to rename the Box: ${error.message}`)
}

export async function deleteBox(actor: Actor, spaceId: string): Promise<void> {
    await assertSpaceAccess(spaceId, 'manage', actor)

    const supabase = createServiceRoleClient()
    const { data: agents } = await selectCount(supabase, 'agents', { space_id: spaceId })
    if (agents) throw new AppError('boxStillHoldsCoworkers', { count: agents })

    const { error } = await supabase.from('spaces').delete().eq('id', spaceId)
    if (error) throw new Error(`Failed to delete the Box: ${error.message}`)
}
