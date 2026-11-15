import type { Database } from '@/app/api/database.types'
import { BASE_PLAN_SLUG, MICROS_PER_USD } from '@rerun/cloud/billing'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { ensureWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { isSandboxLocked } from '@/lib/sandbox-idle/lock'
import { loadSandboxArchive } from '@/lib/sandbox-idle/store'
import { selectMany } from '@/supabase/supabase-helpers'
import { failure, type ActionFailure } from '@/lib/i18n/action-error'

import type { ActionResult } from '@/app/api/_actions/space.actions'

const SANDBOX_SPACE_SIZE = 8
const SANDBOX_ICON_URL = '/pricing/scale.png'
const SANDBOX_BUDGET_USD = 5

export async function enterSandbox(userId: string): Promise<ActionResult<{ workspaceId: number }>> {
    const sandboxId = (await findSandboxWorkspaceId(userId)) ?? (await createSandboxWorkspace(userId))
    if (typeof sandboxId !== 'number') return sandboxId

    if (!(await isSandboxLockedById(sandboxId))) {
        const spaceResult = await ensureSandboxSpace(sandboxId)
        if (spaceResult) return spaceResult
    }

    const switchError = await setActiveWorkspace(userId, sandboxId)
    if (switchError) return { ok: false, error: switchError }

    return { ok: true, workspaceId: sandboxId }
}

export async function resolveCreatorLandingWorkspace(userId: string, workspaceId: number, isExpert: boolean): Promise<number> {
    if (!isExpert) return workspaceId

    try {
        const supabase = createServiceRoleClient()

        const { data: workspaces } = await selectMany(supabase, 'workspaces', ['id', 'is_sandbox'] as const, { id: workspaceId })
        if (workspaces?.[0]?.is_sandbox) return workspaceId

        const { data: spaces } = await selectMany(supabase, 'spaces', ['id'] as const, { workspace_id: workspaceId })
        if ((spaces ?? []).length > 0) return workspaceId

        if (await findSandboxWorkspaceId(userId)) return workspaceId

        const sandboxId = await createSandboxWorkspace(userId)
        if (typeof sandboxId !== 'number') return workspaceId

        await ensureSandboxSpace(sandboxId)
        if (await setActiveWorkspace(userId, sandboxId)) return workspaceId

        return sandboxId
    } catch {
        return workspaceId
    }
}

async function setActiveWorkspace(userId: string, workspaceId: number): Promise<string | null> {
    const supabase = createServiceRoleClient()
    const { error } = await supabase.from('users').update<Database['public']['Tables']['users']['Update']>({ workspace_id: workspaceId }).eq('id', userId)
    return error?.message ?? null
}

async function isSandboxLockedById(workspaceId: number): Promise<boolean> {
    return isSandboxLocked(await loadSandboxArchive(createServiceRoleClient(), workspaceId))
}

async function findSandboxWorkspaceId(userId: string): Promise<number | null> {
    const supabase = createServiceRoleClient()
    const { data: memberships } = await selectMany(supabase, 'workspace_members', ['workspace_id'] as const, { user_id: userId })
    const ids = (memberships ?? []).map(m => m.workspace_id)
    if (ids.length === 0) return null

    const { data: sandboxes } = await selectMany(supabase, 'workspaces', ['id'] as const, { id: ids, is_sandbox: true })
    return sandboxes?.[0]?.id ?? null
}

async function createSandboxWorkspace(userId: string): Promise<number | ActionFailure> {
    const supabase = createServiceRoleClient()

    const { data: workspace, error: workspaceError } = await supabase
        .from('workspaces')
        .insert<Database['public']['Tables']['workspaces']['Insert']>({
            name: 'Sandbox',
            icon_url: SANDBOX_ICON_URL,
            plan: BASE_PLAN_SLUG,
            is_sandbox: true,
            max_agents: null,
            max_seats: 1,
            model_access: 'self_hosted',
            custom_integrations: true,
            rerun_budget_micros: SANDBOX_BUDGET_USD * MICROS_PER_USD,
            rerun_period_anchor: new Date().toISOString(),
            subscription_status: 'active',
            onboarded_at: new Date().toISOString(),
        })
        .select('id')
        .single()

    if (workspaceError || !workspace) return workspaceError ? { ok: false, error: workspaceError.message } : failure('sandboxCreateFailed')

    const workspaceId = (workspace as { id: number }).id

    const { error: membershipError } = await supabase.from('workspace_members').insert<Database['public']['Tables']['workspace_members']['Insert']>({
        user_id: userId,
        workspace_id: workspaceId,
        role: 'admin',
    })
    if (membershipError) return { ok: false, error: membershipError.message }

    return workspaceId
}

export async function ensureSandboxSpace(workspaceId: number): Promise<(ActionFailure & { locked?: true }) | null> {
    const supabase = createServiceRoleClient()

    if (isSandboxLocked(await loadSandboxArchive(supabase, workspaceId))) return { ...failure('sandboxLocked'), locked: true }

    const engine = await ensureWorkspaceEngine(workspaceId)
    if (!engine.ok) return engine

    const { data: spaces } = await selectMany(supabase, 'spaces', ['id'] as const, { workspace_id: workspaceId })
    if ((spaces ?? []).length > 0) return null

    const { error } = await supabase.from('spaces').insert<Database['public']['Tables']['spaces']['Insert']>({
        workspace_id: workspaceId,
        col_start: 0,
        row_start: 0,
        col_end: SANDBOX_SPACE_SIZE - 1,
        row_end: SANDBOX_SPACE_SIZE - 1,
        name: null,
    })
    if (error) return { ok: false, error: error.message }
    return null
}
