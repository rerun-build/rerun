'use server'

import { AuthorizationError, requireAdminContext, requireWorkspaceId } from '@/app/api/_auth/ownership'
import { findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import type { Database } from '@/app/api/database.types'
import { restoreStageOf, type RestoreStage } from '@/lib/archive/restore-stage'
import { isSandboxLocked, reactivationStateOf } from '@/lib/sandbox-idle/lock'
import { loadSandboxArchive } from '@/lib/sandbox-idle/store'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { failure, type ActionFailure } from '@/lib/i18n/action-error'

// `workspace_archives` is service-role only: the restoring banner learns its stage through here,
// and never sees the archive row itself.
export async function getWorkspaceRestoreStageAction(): Promise<RestoreStage | null> {
    const workspaceId = await requireWorkspaceId()
    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['boxes_archived_at'] as const, { id: workspaceId })
    if (!workspace?.boxes_archived_at) return null

    const [{ data: archives }, engine] = await Promise.all([
        selectMany(supabase, 'workspace_archives', ['status', 'error_message'] as const, { workspace_id: workspaceId }, { column: 'created_at', ascending: false }, 1),
        findWorkspaceEngine(workspaceId),
    ])
    return restoreStageOf(archives?.[0] ?? null, !!engine)
}

const REQUEST_NOTE_MAX = 1000

// `restoring`: approved, its archive on the way back to a machine. The other three are a sandbox
// still locked: nothing asked yet, a request waiting on us, or one we declined.
export type SandboxArchiveState = {
    status: 'none' | 'requested' | 'rejected' | 'restoring'
    // Null once the archive has expired and been purged: the lock is all that is left.
    keptUntil: string | null
}

// The one window the client has on a sandbox's archive row. Null for anything that is not a
// sandbox put away: a workspace, a live sandbox, a restore that has landed.
export async function getSandboxArchiveStateAction(): Promise<SandboxArchiveState | null> {
    const workspaceId = await requireWorkspaceId()
    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['is_sandbox', 'boxes_archived_at'] as const, { id: workspaceId })
    if (!workspace?.is_sandbox) return null

    const archive = await loadSandboxArchive(supabase, workspaceId)
    if (!isSandboxLocked(archive)) return workspace.boxes_archived_at ? { status: 'restoring', keptUntil: null } : null

    const state = reactivationStateOf(archive)
    return { status: state === 'approved' ? 'restoring' : state, keptUntil: workspace.boxes_archived_at ? (archive?.expires_at ?? null) : null }
}

export async function requestSandboxReactivationAction(note: string): Promise<{ ok: true } | ActionFailure> {
    const ctx = await requireAdminContext('adminOnlySandboxReactivation').catch((err: unknown) => {
        if (err instanceof AuthorizationError) return err
        throw err
    })
    if (ctx instanceof AuthorizationError) return failure(ctx.code, ctx.params)
    const workspaceId = ctx.workspace.id
    const supabase = createServiceRoleClient()

    const trimmed = note.trim()
    if (!trimmed) return failure('reactivationNoteRequired')
    if (trimmed.length > REQUEST_NOTE_MAX) return failure('keepItUnderDot', { max: String(REQUEST_NOTE_MAX) })

    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['is_sandbox'] as const, { id: workspaceId })
    const archive = workspace?.is_sandbox ? await loadSandboxArchive(supabase, workspaceId) : null
    if (!archive || !isSandboxLocked(archive)) return failure('sandboxNotArchived')
    if (reactivationStateOf(archive) !== 'none') return failure('reactivationAlreadyRequested')

    const { error } = await supabase
        .from('workspace_archives')
        .update<Database['public']['Tables']['workspace_archives']['Update']>({ reactivation_requested_at: new Date().toISOString(), reactivation_request_note: trimmed })
        .eq('id', archive.id)
    if (error) return failure('sendRequestFailed')
    return { ok: true }
}
