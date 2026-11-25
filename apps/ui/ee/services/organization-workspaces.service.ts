import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import { reconcileAgentActivation, wakePlanLimitedAgents } from '@/app/api/_services/agent-activation.service'
import { moveToOtherWorkspace } from '@/app/api/_services/default-workspace.service'
import { inviteMember, isEmailAddress } from '@/app/api/_services/members.service'
import type { Database } from '@/app/api/database.types'
import { selectWorkspaceMembers } from '@/app/api/_auth/workspace-members'
import { spentPerDay } from '@/ee/lib/billing/credit-usage'
import { addOneMonth } from '@/ee/lib/billing/cancel-flow'
import { ORGANIZATION_PLAN_SLUG, organizationLimitsToColumns } from '@/ee/lib/billing/plans'
import { stopBilling } from '@/ee/lib/billing/stop-billing'
import { organizationMachineState, organizationWorkspaceStatus, type OrganizationMachineState, type OrganizationWorkspaceStatus } from '@/ee/lib/organizations/workspace-state'
import { readOrganization, readOrganizationWorkspaces, requireOrganizationWorkspace, type OrganizationContext, type OrganizationWorkspaceRow } from '@/ee/services/organization-context.service'
import { batchesOf } from '@/ee/lib/organizations/batches'
import { allocateOrganizationCredit, returnAllocatedCredit } from '@/ee/services/organization-credit.service'
import { pendingInvitationUrl } from '@/ee/services/organization-members.service'
import { remainingMicros } from '@/ee/services/rerunBudget.service'
import { syncWorkspaceAppsSafely } from '@/lib/apps/lifecycle'
import { randomBlob } from '@/lib/blobs/catalog'
import { ensureForemanAgentRow } from '@/lib/foreman/agent-row'
import { AppError } from '@/lib/i18n/action-error'
import { WORKSPACE_NAME_MAX } from '@/lib/naming/workspace-name'
import { readWorkspaceLogo } from '@/lib/workspace/read-logo'
import { selectAll, selectCount, selectMany } from '@/supabase/supabase-helpers'
import { requestAgentActivationSync } from '@/trigger/sync-agent-activation'
import { archiveOrganizationMachine, destroyOrganizationMachine, readOrganizationMachine, readOrganizationMachines, restartOrganizationMachine, restoreOrganizationMachine, type OrganizationMachine } from '@rerun/cloud/organizations.server'
import { parseCoworkerLook, type CoworkerLook } from '@rerun/contracts'
import { isStableLocale } from '@rerun/i18n'

type Client = SupabaseClient<Database>
type WorkspaceInsert = Database['public']['Tables']['workspaces']['Insert']
type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

const IN_FLIGHT_STATUSES = ['archiving', 'restoring'] as const

export type OrganizationWorkspaceSummary = {
    id: number
    name: string | null
    iconUrl: string | null
    status: OrganizationWorkspaceStatus
    createdAt: string
    lastActiveAt: string | null
    memberCount: number
    coworkerCount: number
    // The first ones, enough to draw its board.
    coworkers: OrganizationCoworker[]
    // The invitation of its admin, until someone joins.
    pendingAdmin: { invitationId: string; email: string; expired: boolean } | null
    // Spent since its month began, and what it can still spend.
    usedMicros: number
    leftMicros: number
    spentPerDayMicros: number
    machine: OrganizationMachineState
    diskPercent: number | null
}

export type OrganizationCoworker = { id: string; name: string; look: CoworkerLook | null; status: 'idle' | 'working' | 'offline' }

const BOARD_COWORKERS = 8
const AGENTS_PER_READ = 100

function countBy(rows: { workspace_id: number }[]): Map<number, number> {
    const counts = new Map<number, number>()
    for (const { workspace_id } of rows) counts.set(workspace_id, (counts.get(workspace_id) ?? 0) + 1)
    return counts
}

// The counter is reset by the first call of a new month, so a workspace that went quiet still carries
// the spending of an older one.
function usedThisMonth(workspace: OrganizationWorkspaceRow, now: Date): number {
    if (workspace.rerun_period_anchor && addOneMonth(new Date(workspace.rerun_period_anchor)) <= now) return 0
    return workspace.rerun_used_micros
}

async function workingAmong(supabase: Client, agentIds: string[]): Promise<Set<string>> {
    const reads = await Promise.all(Array.from({ length: Math.ceil(agentIds.length / AGENTS_PER_READ) }, (_, index) => selectAll(supabase, 'sessions', ['agent_id'] as const, { agent_id: agentIds.slice(index * AGENTS_PER_READ, (index + 1) * AGENTS_PER_READ), status: 'working' })))
    return new Set(reads.flatMap(({ data }) => (data ?? []).map(session => session.agent_id)))
}

async function summarize(supabase: Client, workspaces: OrganizationWorkspaceRow[]): Promise<OrganizationWorkspaceSummary[]> {
    const machinesRead = readOrganizationMachines(workspaces.map(workspace => workspace.id)).catch(err => {
        console.error('[organizations] could not read the machines', err)
        return new Map<number, OrganizationMachine>()
    })
    const batches = await Promise.all(
        batchesOf(workspaces.map(workspace => workspace.id)).map(ids =>
            Promise.all([
                selectWorkspaceMembers(supabase, ['workspace_id'] as const, { workspace_id: ids }),
                selectAll(supabase, 'agents', ['id', 'workspace_id', 'name', 'look', 'disabled_at'] as const, { workspace_id: ids, kind: 'coworker' }, { column: 'created_at', ascending: true }),
                selectAll(supabase, 'engine_pool', ['claimed_by_workspace_id', 'status', 'provider_server_id'] as const, { claimed_by_workspace_id: ids }),
                selectAll(supabase, 'workspace_archives', ['workspace_id', 'status'] as const, { workspace_id: ids }, { column: 'created_at', ascending: true }),
                selectAll(supabase, 'workspace_invitations', ['id', 'workspace_id', 'email', 'expires_at'] as const, { workspace_id: ids, status: 'pending', role: 'admin' }, { column: 'created_at', ascending: true }),
            ]),
        ),
    )
    const members = countBy(batches.flatMap(([rows]) => rows.data ?? []))
    const agents = Map.groupBy(batches.flatMap(([, rows]) => rows.data ?? []), agent => agent.workspace_id)
    const invitations = Map.groupBy(batches.flatMap(([, , , , rows]) => rows.data ?? []), invitation => invitation.workspace_id)
    const shown = new Map([...agents].map(([id, rows]) => [id, rows.slice(0, BOARD_COWORKERS)]))
    const working = await workingAmong(supabase, [...shown.values()].flat().flatMap(agent => (agent.disabled_at ? [] : agent.id)))
    const machines = await machinesRead
    const instances = new Map(batches.flatMap(([, , rows]) => rows.data ?? []).map(row => [row.claimed_by_workspace_id, row]))
    const archives = new Map(batches.flatMap(([, , , rows]) => rows.data ?? []).map(row => [row.workspace_id, row.status]))

    const now = new Date()
    return workspaces.map(workspace => {
        const status = organizationWorkspaceStatus(workspace)
        const usedMicros = usedThisMonth(workspace, now)
        const invitation = invitations.get(workspace.id)?.at(-1)
        const disk = machines.get(workspace.id)?.disk
        return {
            id: workspace.id,
            name: workspace.name,
            iconUrl: workspace.icon_url,
            status,
            createdAt: workspace.created_at,
            lastActiveAt: workspace.last_active_at,
            memberCount: members.get(workspace.id) ?? 0,
            coworkerCount: agents.get(workspace.id)?.length ?? 0,
            coworkers: (shown.get(workspace.id) ?? []).map(({ id, name, look, disabled_at }) => ({ id, name, look: parseCoworkerLook(look), status: disabled_at ? 'offline' : working.has(id) ? 'working' : 'idle' })),
            pendingAdmin: members.has(workspace.id) || !invitation ? null : { invitationId: invitation.id, email: invitation.email, expired: new Date(invitation.expires_at) < now },
            usedMicros,
            leftMicros: remainingMicros({ budgetMicros: workspace.rerun_budget_micros, usedMicros, topupMicros: workspace.rerun_topup_micros }),
            spentPerDayMicros: workspace.rerun_period_anchor ? spentPerDay(usedMicros, new Date(workspace.rerun_period_anchor), now) : 0,
            diskPercent: disk ? Math.round((disk.usedMb / disk.totalMb) * 100) : null,
            machine: organizationMachineState({ status, boxesArchivedAt: workspace.boxes_archived_at, instance: instances.get(workspace.id) ?? null, archiveStatus: archives.get(workspace.id) ?? null }),
        }
    })
}

export async function listOrganizationWorkspaces(ctx: OrganizationContext): Promise<OrganizationWorkspaceSummary[]> {
    return summarize(ctx.supabase, await readOrganizationWorkspaces(ctx))
}

export type OrganizationWorkspaceDetail = OrganizationWorkspaceSummary & { locale: string; hardware: OrganizationMachine | null }

export async function loadOrganizationWorkspace(ctx: OrganizationContext, workspaceId: number): Promise<OrganizationWorkspaceDetail> {
    const workspace = await requireOrganizationWorkspace(ctx, workspaceId)
    const [[summary], hardware] = await Promise.all([summarize(ctx.supabase, [workspace]), readOrganizationMachine(workspaceId)])
    return { ...summary, locale: workspace.locale, hardware }
}

function workspaceName(formData: FormData): string {
    const name = String(formData.get('name') ?? '').trim()
    if (!name) throw new AppError('nameRequired')
    if (name.length > WORKSPACE_NAME_MAX) throw new AppError('nameTooLong', { max: WORKSPACE_NAME_MAX })
    return name
}

function workspaceLocaleOf(formData: FormData): string | undefined {
    const locale = formData.get('locale')
    if (locale === null || locale === '') return undefined
    if (!isStableLocale(locale)) throw new AppError('unknownLanguage')
    return locale
}

export async function countWorkspaces(supabase: Client, organizationId: string): Promise<number> {
    const { data, error } = await selectCount(supabase, 'workspaces', { organization_id: organizationId })
    if (error || data === null) throw new Error(error?.message ?? 'Could not count the workspaces')
    return data
}

export const limitReached = (max: number) => new AppError('organizationWorkspaceLimit', { max })

export type StartingCredit = { credits: number; requestId: string }
export type CreatedWorkspace = { workspaceId: number; inviteUrl?: string; creditFailed?: true }

// The workspace, the invitation of its first admin with the link to it, and the credit it starts with.
// Credit that could not be moved leaves the workspace where it is: it is given from its page.
export async function createOrganizationWorkspace(ctx: OrganizationContext, formData: FormData, starting: StartingCredit | null = null): Promise<CreatedWorkspace> {
    const { supabase, organization } = ctx
    const name = workspaceName(formData)
    const locale = workspaceLocaleOf(formData)
    const adminEmail = String(formData.get('adminEmail') ?? '').trim()
    if (!isEmailAddress(adminEmail)) throw new AppError('invalidEmailShort')
    if ((await countWorkspaces(supabase, organization.id)) >= organization.max_workspaces) throw limitReached(organization.max_workspaces)

    const { data: created, error } = await supabase
        .from('workspaces')
        .insert<WorkspaceInsert>({
            name,
            icon_url: randomBlob()?.url ?? null,
            plan: ORGANIZATION_PLAN_SLUG,
            subscription_status: 'active',
            ...organizationLimitsToColumns(),
            organization_id: organization.id,
            ...(locale ? { locale } : {}),
        })
        .select('id')
        .single()
    if (error || !created) throw new AppError('createWorkspaceFailed')
    const workspaceId = created.id

    try {
        await assertStillAllowed(supabase, organization.id)
        const logo = await readWorkspaceLogo(formData, workspaceId)
        if (!logo.ok) throw new AppError(logo.code ?? 'imageUnreadable', logo.params)
        if (logo.iconUrl) await updateWorkspace(supabase, workspaceId, { icon_url: logo.iconUrl })

        const invite = await inviteMember({ supabase, workspace: { id: workspaceId, name, max_seats: null }, invitedBy: { userId: ctx.userId, email: null } }, adminEmail, 'all', 'admin')
        if (!invite.ok) throw 'code' in invite ? new AppError(invite.code) : new Error(invite.error)

        // Never blocks the workspace: a row missing here is written the first time it is needed.
        await ensureForemanAgentRow(supabase, workspaceId).catch(err => console.error('[organizations] failed to write the Chief of Staff', err))
    } catch (err) {
        await supabase.from('workspaces').delete().eq('id', workspaceId).eq('organization_id', organization.id)
        throw err
    }

    const creditFailed = starting !== null && !(await startsWith(ctx, workspaceId, starting))
    const inviteUrl = await pendingInvitationUrl(ctx, workspaceId, adminEmail).catch(() => null)
    return { workspaceId, ...(inviteUrl ? { inviteUrl } : {}), ...(creditFailed ? { creditFailed: true as const } : {}) }
}

async function startsWith(ctx: OrganizationContext, workspaceId: number, starting: StartingCredit): Promise<boolean> {
    try {
        await allocateOrganizationCredit(ctx, { workspaceId, ...starting })
        return true
    } catch (err) {
        console.error('[organizations] a new workspace did not get the credit it starts with', workspaceId, err)
        return false
    }
}

// Two tabs, or two people, counted before either wrote: read again once the row is in, along with a
// suspension that landed in between.
export async function assertStillAllowed(supabase: Client, organizationId: string): Promise<void> {
    const [{ data: organization }, count] = await Promise.all([readOrganization(supabase, organizationId), countWorkspaces(supabase, organizationId)])
    if (organization?.status !== 'active') throw new AppError('organizationSuspended')
    if (count > organization.max_workspaces) throw limitReached(organization.max_workspaces)
}

async function updateWorkspace(supabase: Client, workspaceId: number, update: WorkspaceUpdate): Promise<void> {
    const { error } = await supabase.from('workspaces').update<WorkspaceUpdate>(update).eq('id', workspaceId)
    if (error) throw new Error(error.message)
}

// Nothing is lost: the machine is archived, the coworkers and the Boxes stay.
export async function archiveOrganizationWorkspace(ctx: OrganizationContext, workspaceId: number): Promise<void> {
    await requireOrganizationWorkspace(ctx, workspaceId)
    await updateWorkspace(ctx.supabase, workspaceId, { subscription_status: 'canceled', organization_archived_at: new Date().toISOString() })
    await stopRunning(workspaceId)
}

export async function restoreOrganizationWorkspace(ctx: OrganizationContext, workspaceId: number): Promise<void> {
    const workspace = await requireOrganizationWorkspace(ctx, workspaceId)
    await updateWorkspace(ctx.supabase, workspaceId, { subscription_status: 'active', organization_archived_at: null })

    // A suspension that landed in between cut everything off but this one.
    const { data: organization } = await readOrganization(ctx.supabase, ctx.organization.id)
    if (organization?.status !== 'active') {
        await updateWorkspace(ctx.supabase, workspaceId, { subscription_status: 'canceled' })
        throw new AppError('organizationSuspended')
    }
    await startRunning(workspace)
}

async function stopRunning(workspaceId: number): Promise<void> {
    await requestAgentActivationSync(await reconcileAgentActivation(workspaceId))
    await archiveOrganizationMachine(workspaceId)
}

// An archived machine wakes its coworkers once it is back, and not before; one that had not been
// archived yet is woken here.
export async function startRunning(workspace: Pick<OrganizationWorkspaceRow, 'id' | 'boxes_archived_at'>): Promise<void> {
    if (!workspace.boxes_archived_at) {
        const { woken } = await wakePlanLimitedAgents(workspace.id)
        await requestAgentActivationSync(woken, { switchOn: true })
    }
    await restoreOrganizationMachine(workspace.id)
}

export async function assertMachineIdle(supabase: Client, workspaceId: number): Promise<void> {
    const { data, error } = await selectCount(supabase, 'workspace_archives', { workspace_id: workspaceId, status: [...IN_FLIGHT_STATUSES] })
    if (error) throw new Error(error.message)
    if (data) throw new AppError('workspaceMachineBusy')
}

export async function restartOrganizationWorkspace(ctx: OrganizationContext, workspaceId: number): Promise<void> {
    const workspace = await requireOrganizationWorkspace(ctx, workspaceId)
    if (organizationWorkspaceStatus(workspace) !== 'active' || workspace.boxes_archived_at) throw new AppError('workspaceArchived')
    await assertMachineIdle(ctx.supabase, workspaceId)
    await restartOrganizationMachine(workspaceId)
}

// The workspace and everything it carries. Access is cut first, what bills and what costs goes before
// what is only rows, and a machine that resists stops there: the workspace stays in the console, to be
// deleted again.
export async function deleteOrganizationWorkspace(ctx: OrganizationContext, workspaceId: number): Promise<void> {
    const { supabase } = ctx
    const workspace = await requireOrganizationWorkspace(ctx, workspaceId)
    await assertMachineIdle(supabase, workspaceId)
    await updateWorkspace(supabase, workspaceId, { subscription_status: 'canceled', organization_archived_at: workspace.organization_archived_at ?? new Date().toISOString() })

    const billingError = await stopBilling(workspace.stripe_customer_id)
    if (billingError) throw new Error(billingError)
    await syncWorkspaceAppsSafely(supabase, workspaceId, { uninstall: true })
    await destroyOrganizationMachine(workspaceId)
    // After the machine, which could still have spent some.
    await returnAllocatedCredit(ctx, workspace)

    await removeEveryone(supabase, workspaceId)
    for (const table of ['agents', 'spaces'] as const) {
        const { error } = await supabase.from(table).delete().eq('workspace_id', workspaceId)
        if (error) throw new Error(error.message)
    }
    // Someone whose acceptance was already under way when the doors closed.
    await moveEveryoneOut(supabase, workspaceId)
    const { error } = await supabase.from('workspaces').delete().eq('id', workspaceId).eq('organization_id', ctx.organization.id)
    if (error) throw new Error(error.message)
}

// The accounts pointing at the workspace would go with it. Its doors are closed first, so that nobody
// opens it, or joins it, after the last of them was moved.
async function removeEveryone(supabase: Client, workspaceId: number): Promise<void> {
    const { error: inviteError } = await supabase.from('workspace_invitations').delete().eq('workspace_id', workspaceId)
    if (inviteError) throw new Error(inviteError.message)
    const { error: memberError } = await supabase.from('workspace_members').delete().eq('workspace_id', workspaceId)
    if (memberError) throw new Error(memberError.message)
    await moveEveryoneOut(supabase, workspaceId)
}

async function moveEveryoneOut(supabase: Client, workspaceId: number): Promise<void> {
    const { data: users, error } = await selectAll(supabase, 'users', ['id'] as const, { workspace_id: workspaceId })
    if (error) throw new Error(error.message)
    for (const user of users) await moveToOtherWorkspace(supabase, user.id, workspaceId, { openOne: true })
}

// Suspending an organization cuts every workspace off; resuming gives back the ones its team had not
// put away itself. Rerun's own decision, so neither asks who the caller is.
export async function suspendOrganization(supabase: Client, organizationId: string): Promise<void> {
    await setOrganizationStatus(supabase, organizationId, 'suspended')
    for (const { id } of await switchWorkspaces(supabase, organizationId, 'canceled')) await stopRunning(id)
}

export async function resumeOrganization(supabase: Client, organizationId: string): Promise<void> {
    await setOrganizationStatus(supabase, organizationId, 'active')
    for (const workspace of await switchWorkspaces(supabase, organizationId, 'active')) await startRunning(workspace)
}

async function setOrganizationStatus(supabase: Client, organizationId: string, status: 'active' | 'suspended'): Promise<void> {
    const { error } = await supabase.from('organizations').update<Database['public']['Tables']['organizations']['Update']>({ status }).eq('id', organizationId)
    if (error) throw new Error(error.message)
}

async function switchWorkspaces(supabase: Client, organizationId: string, subscription_status: 'active' | 'canceled'): Promise<Pick<OrganizationWorkspaceRow, 'id' | 'boxes_archived_at'>[]> {
    const { data, error: readError } = await selectMany(supabase, 'workspaces', ['id', 'boxes_archived_at'] as const, { organization_id: organizationId, organization_archived_at: { isNull: true }, subscription_status: { neq: subscription_status } })
    if (readError) throw new Error(readError.message)
    const workspaces = data ?? []
    if (workspaces.length === 0) return []
    const { error } = await supabase
        .from('workspaces')
        .update<WorkspaceUpdate>({ subscription_status })
        .in('id', workspaces.map(workspace => workspace.id))
        .is('organization_archived_at', null)
    if (error) throw new Error(error.message)
    return workspaces
}
