import type { Database } from '@/app/api/database.types'
import { BASE_PLAN_SLUG, MICROS_PER_USD } from '@rerun/cloud/billing'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { ensureWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { isSandboxLocked } from '@/lib/sandbox-idle/lock'
import { loadSandboxArchive } from '@/lib/sandbox-idle/store'
import { selectMany } from '@/supabase/supabase-helpers'
import { failure, type ActionFailure } from '@/lib/i18n/action-error'

import type { ActionResult } from '@/app/api/_actions/space.actions'

// A sandbox is a workspace flagged is_sandbox with unlimited agents and no billing, reserved for
// expert accounts. It reuses the whole workspace/space/engine stack: exactly one Space backed by a
// dedicated pool engine for now.
const SANDBOX_SPACE_SIZE = 8
const SANDBOX_ICON_URL = '/pricing/scale.png'
const SANDBOX_BUDGET_USD = 5

// Get-or-create, then make it the active workspace. Idempotent: it reuses the existing sandbox
// workspace (and re-claims its engine if it lost one), so re-entry self-heals. The caller owns the
// expert check — this module never decides who is entitled to a sandbox.
export async function enterSandbox(userId: string): Promise<ActionResult<{ workspaceId: number }>> {
    const sandboxId = (await findSandboxWorkspaceId(userId)) ?? (await createSandboxWorkspace(userId))
    if (typeof sandboxId !== 'number') return sandboxId

    // A locked sandbox is still entered: that is where its owner reads why it is archived and asks
    // for it back. It just gets no machine on the way in.
    if (!(await isSandboxLockedById(sandboxId))) {
        const spaceResult = await ensureSandboxSpace(sandboxId)
        if (spaceResult) return spaceResult
    }

    const switchError = await setActiveWorkspace(userId, sandboxId)
    if (switchError) return { ok: false, error: switchError }

    return { ok: true, workspaceId: sandboxId }
}

// Where the home has to render for this user. A creator whose account was just flagged expert still
// lands on the workspace the middleware provisioned for them: empty, so the client would open the
// recruit wizard and end at a paywall, on an account already entitled to an unlimited sandbox.
//
// Only the first landing moves them. Once `users.workspace_id` points at the sandbox it stays there,
// and an expert who later creates or joins another workspace is left alone — hence the guard on
// "no sandbox yet" rather than on "current workspace is empty" alone.
//
// An empty pool is not a reason to stay behind: the sandbox becomes active without a Space and
// useEnsureSandboxSpace keeps retrying the claim behind the "Preparing your sandbox…" board.
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
            // A sandbox has no onboarding: the funnel never runs there, so nothing would ever stamp it.
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

// Claims the sandbox's machine and draws its single Box, if it has none yet. Returns an error
// result when the pool is empty (nothing is claimed, so re-entry retries cleanly); returns null on
// success or when the sandbox is already set up. Self-healing: the machine is looked up by
// workspace, so a Box row lost on its own does not leave the engine stranded.
export async function ensureSandboxSpace(workspaceId: number): Promise<(ActionFailure & { locked?: true }) | null> {
    const supabase = createServiceRoleClient()

    // Before any claim, and not left to `ensureWorkspaceEngine`: once an expired archive is purged
    // the workspace is no longer flagged archived, and this is the only door still shut.
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
