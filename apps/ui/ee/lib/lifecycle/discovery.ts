// Every Supabase read of one sweep. The rest of the module works off resolved snapshots, so this is
// the only file that has to know how a signal is stored.
//
// Two shapes recur. Anti-joins ("agents that never ran", "workspaces with no agent") are done by
// fetching the positive side over the same bounded id list and subtracting with a Set: PostgREST has
// no NOT EXISTS.
import { isStoreProvider } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import type { OnboardingAnswers } from '@/app/actions/onboarding'
import { isMachineEntitled, isPaidSubscription, isTrialLapsed } from '@/ee/lib/billing/entitlement'
import { wantsCategoryEmail } from '@/lib/notifications/prefs'
import { loadRecommendCandidates, recommendContext, shortlistTemplates, type TemplateCandidate } from '@/lib/templates/recommend'
import { selectAll, selectCount, selectMany } from '@/supabase/supabase-helpers'
import { latestCompletedArchives } from '@/lib/archive/latest'
import type { LifecycleAgent, LifecycleArchive, LifecycleSnapshot } from './decide'
import { ARCHIVE_EXPIRING_LEAD_MS, LIFECYCLE_SEQUENCES, SUBSCRIPTION_ENDING_LEADS, TRIAL_ENDING_LEAD_MS, lifecycleFloor } from './sequences'
import { loadSentIndex, sendsFor } from './store'

// Enough to drain any realistic backlog at one email per user per tick, and short enough to keep the
// IN lists well under PostgREST's URL limit.
const CANDIDATE_LIMIT = 200
const RUN_SCAN_LIMIT = 5000
const RUN_SCAN_PAGE = 1000

// Every run the engine reports ends on one of these, whatever started it.
const RUN_COMPLETION_EVENTS = ['agent.message.completed', 'agent.schedule.completed', 'agent.trigger.completed']

// A run started from the chat carries no `source`: the engine cannot send 'chat', which is not a
// session_source on the hub side. See apps/engine/src/runtime/loop.ts.
const MANUAL_EVENT = 'agent.message.completed'

const MIN_MANUAL_RUNS = 2

type Client = SupabaseClient<Database>

export type WorkspaceRow = {
    id: number
    name: string | null
    is_sandbox: boolean
    trial_ends_at: string | null
    subscription_status: string | null
    subscription_cancel_at: string | null
    first_paid_at: string | null
    stripe_customer_id: string | null
    stripe_subscription_id: string | null
    current_period_end: string | null
    onboarded_at: string | null
    boxes_archived_at: string | null
    payment_failed_at: string | null
    renewal_reminder_at: string | null
    renewal_reminder_user_id: string | null
    billing_provider: string | null
    // What the workspace's onboarding learned, read from workspace_onboarding and kept beside the
    // row because the recommendation email is the only thing that needs it.
    onboarding_answers: unknown
}

const WORKSPACE_COLUMNS = [
    'id',
    'name',
    'is_sandbox',
    'trial_ends_at',
    'subscription_status',
    'subscription_cancel_at',
    'first_paid_at',
    'stripe_customer_id',
    'stripe_subscription_id',
    'current_period_end',
    'onboarded_at',
    'renewal_reminder_at',
    'renewal_reminder_user_id',
    'boxes_archived_at',
    'payment_failed_at',
    'billing_provider',
] as const
export type UserRow = { id: string; workspace_id: number; signed_up_at: string | null; email_notification_prefs: unknown }
type MemberRow = { workspace_id: number; user_id: string; created_at: string }

export type LifecycleContext = {
    snapshots: LifecycleSnapshot[]
    // Carried beside the snapshots because the emails need them and the decision does not.
    users: Map<string, UserRow>
    workspaces: Map<number, WorkspaceRow>
    agentNames: Map<string, string>
}

function since(now: Date, ms: number, floor: Date | null): string {
    const start = new Date(now.getTime() - ms)
    return (floor && floor > start ? floor : start).toISOString()
}

// Onboarding is a workspace fact, so whether a signup finished it is only known once their workspace
// is read: every recent signup comes in, and the rung itself leaves out the onboarded ones.
async function findCandidateUsers(supabase: Client, now: Date): Promise<Set<string>> {
    const { data } = await selectMany(
        supabase,
        'users',
        ['id'] as const,
        { signed_up_at: { gte: since(now, LIFECYCLE_SEQUENCES.onboarding_resume.maxAgeMs, lifecycleFloor()) } },
        { column: 'signed_up_at', ascending: true },
        CANDIDATE_LIMIT,
    )
    return new Set((data ?? []).map(row => row.id))
}

async function findOnboardedWorkspaces(supabase: Client, now: Date): Promise<Set<number>> {
    const { data } = await selectMany(
        supabase,
        'workspaces',
        ['id'] as const,
        { onboarded_at: { gte: since(now, LIFECYCLE_SEQUENCES.agent_recommendations.maxAgeMs, lifecycleFloor()) }, is_sandbox: false },
        { column: 'onboarded_at', ascending: true },
        CANDIDATE_LIMIT,
    )
    return new Set((data ?? []).map(row => row.id))
}

// Newest first on both sides of the deadline, with the lower bounds applied in TypeScript. Read
// oldest first, the trials already handled filled the limit and the newest ones never got their
// notice, which also meant their box was never torn down.
async function findCandidateWorkspaces(supabase: Client, now: Date): Promise<Set<number>> {
    const trialsByLatestEnd = (upTo: Date) =>
        selectMany(supabase, 'workspaces', ['id', 'trial_ends_at'] as const, { trial_ends_at: { lte: upTo.toISOString() }, is_sandbox: false }, { column: 'trial_ends_at', ascending: false }, CANDIDATE_LIMIT)

    const [endingSoon, ended] = await Promise.all([trialsByLatestEnd(new Date(now.getTime() + TRIAL_ENDING_LEAD_MS)), trialsByLatestEnd(now)])
    const endedSince = Date.parse(since(now, LIFECYCLE_SEQUENCES.trial_ended.maxAgeMs, lifecycleFloor()))

    return new Set([
        ...(endingSoon.data ?? []).filter(row => row.trial_ends_at && Date.parse(row.trial_ends_at) > now.getTime()).map(row => row.id),
        ...(ended.data ?? []).filter(row => row.trial_ends_at && Date.parse(row.trial_ends_at) >= endedSince).map(row => row.id),
    ])
}

// The workspaces whose subscription has an end date in the next week.
async function findEndingWorkspaces(supabase: Client, now: Date): Promise<Set<number>> {
    const { data } = await selectMany(
        supabase,
        'workspaces',
        ['id', 'subscription_cancel_at'] as const,
        { subscription_cancel_at: { gte: now.toISOString() }, is_sandbox: false },
        { column: 'subscription_cancel_at', ascending: true },
        CANDIDATE_LIMIT,
    )
    const horizon = now.getTime() + LIFECYCLE_SEQUENCES.subscription_ending_7d.maxAgeMs + SUBSCRIPTION_ENDING_LEADS.subscription_ending_7d
    return new Set((data ?? []).filter(row => row.subscription_cancel_at && Date.parse(row.subscription_cancel_at) <= horizon).map(row => row.id))
}

// Archives expiring within the notice's week, soonest first, then checked against each workspace's
// latest archive: an older one left by an earlier pause can be expiring while the current one has
// months to go.
async function findExpiringArchives(supabase: Client, now: Date): Promise<Map<number, LifecycleArchive>> {
    const { data: expiring } = await selectMany(
        supabase,
        'workspace_archives',
        ['workspace_id', 'expires_at'] as const,
        { archived_at: { notNull: true }, expires_at: { gte: now.toISOString() } },
        { column: 'expires_at', ascending: true },
        CANDIDATE_LIMIT,
    )
    const horizon = now.getTime() + ARCHIVE_EXPIRING_LEAD_MS
    const workspaceIds = [...new Set((expiring ?? []).filter(row => row.expires_at && Date.parse(row.expires_at) <= horizon).map(row => row.workspace_id))]
    if (workspaceIds.length === 0) return new Map()

    const { data: archives } = await selectAll(supabase, 'workspace_archives', ['workspace_id', 'archived_at', 'expires_at'] as const, { workspace_id: workspaceIds, archived_at: { notNull: true } }, { column: 'id' })
    const paused = new Map<number, LifecycleArchive>()
    for (const [workspaceId, archive] of latestCompletedArchives(archives ?? [])) {
        if (archive.archived_at && archive.expires_at) paused.set(workspaceId, { archivedAt: new Date(archive.archived_at), expiresAt: new Date(archive.expires_at) })
    }
    return paused
}

// The people whose renewal reminder is due. They are recipients in their own right, not through
// their workspace's founder: the reminder goes to whoever asked for it.
async function findReminderRequesters(supabase: Client, now: Date): Promise<Set<string>> {
    const { data } = await selectMany(
        supabase,
        'workspaces',
        ['renewal_reminder_at', 'renewal_reminder_user_id'] as const,
        { renewal_reminder_at: { gte: new Date(now.getTime() - LIFECYCLE_SEQUENCES.renewal_reminder_7d.maxAgeMs).toISOString() }, is_sandbox: false },
        { column: 'renewal_reminder_at', ascending: true },
        CANDIDATE_LIMIT,
    )
    return new Set((data ?? []).flatMap(row => (row.renewal_reminder_user_id && row.renewal_reminder_at && Date.parse(row.renewal_reminder_at) <= now.getTime() ? [row.renewal_reminder_user_id] : [])))
}

async function findIdleAgents(supabase: Client, now: Date): Promise<Map<number, LifecycleAgent[]>> {
    const { data: young } = await selectMany(
        supabase,
        'agents',
        ['id', 'workspace_id', 'name', 'created_at'] as const,
        { created_at: { gte: since(now, LIFECYCLE_SEQUENCES.agent_idle.maxAgeMs, lifecycleFloor()) }, disabled_at: { isNull: true } },
        { column: 'created_at', ascending: true },
        CANDIDATE_LIMIT,
    )
    const agents = young ?? []
    if (agents.length === 0) return new Map()

    const { data: ran } = await selectAll(supabase, 'notifications', ['agent_id'] as const, { agent_id: agents.map(agent => agent.id), event: RUN_COMPLETION_EVENTS }, { column: 'id' })
    const everRan = new Set((ran ?? []).map(row => row.agent_id))

    const byWorkspace = new Map<number, LifecycleAgent[]>()
    for (const agent of agents) {
        if (everRan.has(agent.id)) continue
        const list = byWorkspace.get(agent.workspace_id) ?? []
        list.push({ id: agent.id, name: agent.name, at: new Date(agent.created_at) })
        byWorkspace.set(agent.workspace_id, list)
    }
    return byWorkspace
}

type RunScan = {
    firstSuccessByWorkspace: Map<number, Date>
    successesByWorkspace: Map<number, number>
    manualByAgent: Map<string, { count: number; last: Date; workspaceId: number }>
    scheduledAgents: Set<string>
}

// Page by page: PostgREST answers at most `max_rows` (1000) whatever the limit asked, so a single
// read of RUN_SCAN_LIMIT rows silently stopped at the first thousand.
async function readRecentRuns(supabase: Client, now: Date) {
    const rows: { workspace_id: number; agent_id: string | null; event: string; kind: string; source: string | null; created_at: string }[] = []
    for (let offset = 0; offset < RUN_SCAN_LIMIT; offset += RUN_SCAN_PAGE) {
        const { data } = await selectMany(
            supabase,
            'notifications',
            ['workspace_id', 'agent_id', 'event', 'kind', 'source', 'created_at'] as const,
            { created_at: { gte: since(now, LIFECYCLE_SEQUENCES.automate_agent.maxAgeMs, lifecycleFloor()) }, agent_id: { notNull: true }, event: RUN_COMPLETION_EVENTS },
            // Newest first: past the limit it is the far end of the window that is dropped, and a
            // workspace whose first result landed this morning is exactly who these emails are for.
            { column: 'created_at', ascending: false },
            RUN_SCAN_PAGE,
            offset,
        )
        rows.push(...(data ?? []))
        if (!data || data.length < RUN_SCAN_PAGE) break
    }
    return rows
}

// One pass over the run log serves both the team invite and the automation nudge, which read the
// same rows for different reasons.
async function scanRuns(supabase: Client, now: Date): Promise<RunScan> {
    const rows = await readRecentRuns(supabase, now)

    const scan: RunScan = { firstSuccessByWorkspace: new Map(), successesByWorkspace: new Map(), manualByAgent: new Map(), scheduledAgents: new Set() }
    for (const row of rows) {
        if (!row.agent_id) continue
        const at = new Date(row.created_at)

        if (row.event === 'agent.schedule.completed') scan.scheduledAgents.add(row.agent_id)
        if (row.kind !== 'done') continue

        const earliest = scan.firstSuccessByWorkspace.get(row.workspace_id)
        if (!earliest || at < earliest) scan.firstSuccessByWorkspace.set(row.workspace_id, at)
        scan.successesByWorkspace.set(row.workspace_id, (scan.successesByWorkspace.get(row.workspace_id) ?? 0) + 1)

        if (row.event === MANUAL_EVENT && row.source === null) {
            const entry = scan.manualByAgent.get(row.agent_id)
            scan.manualByAgent.set(row.agent_id, { count: (entry?.count ?? 0) + 1, last: entry && entry.last > at ? entry.last : at, workspaceId: row.workspace_id })
        }
    }
    return scan
}

// The run scan only proves no schedule fired inside its window. The "ever" half is confirmed one
// query per finalist, a handful per tick, rather than by widening the scan for everyone.
async function neverScheduled(supabase: Client, agentIds: string[]): Promise<Set<string>> {
    const never = new Set<string>()
    await Promise.all(
        agentIds.map(async agentId => {
            const { data, error } = await selectCount(supabase, 'notifications', { agent_id: agentId, event: 'agent.schedule.completed' })
            if (!error && (data ?? 0) === 0) never.add(agentId)
        }),
    )
    return never
}

function tally<T>(rows: T[], key: (row: T) => number): Map<number, number> {
    const counts = new Map<number, number>()
    for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1)
    return counts
}

function foundersOf(members: MemberRow[]): Map<number, string> {
    const earliest = new Map<number, MemberRow>()
    for (const member of members) {
        const current = earliest.get(member.workspace_id)
        if (!current || member.created_at < current.created_at) earliest.set(member.workspace_id, member)
    }
    return new Map([...earliest].map(([workspaceId, member]) => [workspaceId, member.user_id]))
}

async function loadAgentNames(supabase: Client, agentIds: string[]): Promise<Map<string, string>> {
    if (agentIds.length === 0) return new Map()
    const { data } = await selectAll(supabase, 'agents', ['id', 'name'] as const, { id: agentIds }, { column: 'id' })
    return new Map((data ?? []).map(row => [row.id, row.name]))
}

// The catalogue is read once for the whole tick, and only when someone could actually receive the
// recommendation email.
async function loadTemplatesIfNeeded(supabase: Client, users: UserRow[], workspaces: Map<number, WorkspaceRow>, agentCounts: Map<number, number>): Promise<TemplateCandidate[] | null> {
    const needed = users.some(user => workspaces.get(user.workspace_id)?.onboarded_at && (agentCounts.get(user.workspace_id) ?? 0) === 0)
    return needed ? loadRecommendCandidates(supabase) : null
}

function habitAgentsFor(runs: RunScan, confirmed: Set<string>, names: Map<string, string>, workspaceId: number): LifecycleAgent[] {
    return [...runs.manualByAgent.entries()]
        .filter(([agentId, entry]) => confirmed.has(agentId) && entry.workspaceId === workspaceId)
        .map(([agentId, entry]) => ({ id: agentId, name: names.get(agentId) ?? 'your coworker', at: entry.last, runs: entry.count }))
}

/**
 * One snapshot per person the sweeper should consider. `only` narrows the whole sweep to a few
 * accounts, which is how the task is exercised by hand without touching anybody else.
 */
export async function loadLifecycleContext(supabase: Client, now: Date, only?: string[]): Promise<LifecycleContext> {
    const empty: LifecycleContext = { snapshots: [], users: new Map(), workspaces: new Map(), agentNames: new Map() }

    const [userIds, workspaceIds, endingWorkspaceIds, onboardedWorkspaceIds, expiringArchives, reminderRequesters, idleAgents, runs] = await Promise.all([
        findCandidateUsers(supabase, now),
        findCandidateWorkspaces(supabase, now),
        findEndingWorkspaces(supabase, now),
        findOnboardedWorkspaces(supabase, now),
        findExpiringArchives(supabase, now),
        findReminderRequesters(supabase, now),
        findIdleAgents(supabase, now),
        scanRuns(supabase, now),
    ])

    for (const userId of reminderRequesters) userIds.add(userId)

    for (const workspaceId of endingWorkspaceIds) workspaceIds.add(workspaceId)
    for (const workspaceId of expiringArchives.keys()) workspaceIds.add(workspaceId)
    for (const workspaceId of onboardedWorkspaceIds) workspaceIds.add(workspaceId)

    for (const workspaceId of idleAgents.keys()) workspaceIds.add(workspaceId)
    for (const workspaceId of runs.firstSuccessByWorkspace.keys()) workspaceIds.add(workspaceId)
    for (const entry of runs.manualByAgent.values()) workspaceIds.add(entry.workspaceId)
    if (workspaceIds.size === 0 && userIds.size === 0) return empty

    // Read once here to turn the candidate workspaces into recipients, and again below over the
    // wider set, once the users have brought their own workspaces in.
    const { data: memberRows } = await selectAll(supabase, 'workspace_members', ['workspace_id', 'user_id', 'created_at'] as const, { workspace_id: [...workspaceIds] }, { column: 'created_at' })
    for (const founder of foundersOf(memberRows ?? []).values()) userIds.add(founder)

    if (only) for (const id of [...userIds]) if (!only.includes(id)) userIds.delete(id)
    if (userIds.size === 0) return empty

    const { data: userRows } = await selectAll(supabase, 'users', ['id', 'workspace_id', 'signed_up_at', 'email_notification_prefs'] as const, { id: [...userIds] }, { column: 'id' })
    const users = (userRows ?? []) as UserRow[]
    const allWorkspaceIds = [...new Set([...workspaceIds, ...users.map(user => user.workspace_id)])]

    const [{ data: workspaceRows }, { data: onboardingRows }, { data: allMembers }, { data: allAgents }] = await Promise.all([
        selectAll(supabase, 'workspaces', WORKSPACE_COLUMNS, { id: allWorkspaceIds }, { column: 'id' }),
        selectAll(supabase, 'workspace_onboarding', ['workspace_id', 'answers'] as const, { workspace_id: allWorkspaceIds }, { column: 'workspace_id' }),
        // Rows rather than a count per workspace: one query beats one per workspace.
        selectAll(supabase, 'workspace_members', ['workspace_id', 'user_id', 'created_at'] as const, { workspace_id: allWorkspaceIds }, { column: 'created_at' }),
        selectAll(supabase, 'agents', ['workspace_id'] as const, { workspace_id: allWorkspaceIds }, { column: 'id' }),
    ])

    const answersByWorkspace = new Map((onboardingRows ?? []).map(row => [row.workspace_id, row.answers]))
    const workspaces = new Map((workspaceRows ?? []).map(row => [row.id, { ...row, onboarding_answers: answersByWorkspace.get(row.id) ?? null } as WorkspaceRow]))
    const memberCounts = tally(allMembers ?? [], row => row.workspace_id)
    const agentCounts = tally(allAgents ?? [], row => row.workspace_id)
    const founders = foundersOf(allMembers ?? [])

    const habitFinalists = [...runs.manualByAgent.entries()].filter(([agentId, entry]) => entry.count >= MIN_MANUAL_RUNS && !runs.scheduledAgents.has(agentId)).map(([agentId]) => agentId)
    const confirmedHabit = await neverScheduled(supabase, habitFinalists)

    const [agentNames, templates, sent] = await Promise.all([
        loadAgentNames(supabase, [...new Set([...confirmedHabit, ...[...idleAgents.values()].flat().map(agent => agent.id)])]),
        loadTemplatesIfNeeded(supabase, users, workspaces, agentCounts),
        loadSentIndex(supabase, [...userIds], allWorkspaceIds),
    ])

    const snapshots = users.map(user => {
        const workspace = workspaces.get(user.workspace_id)
        const answers = (workspace?.onboarding_answers ?? null) as OnboardingAnswers | null

        return {
            userId: user.id,
            workspaceId: user.workspace_id,
            isFounder: founders.get(user.workspace_id) === user.id,
            isSandbox: workspace?.is_sandbox ?? true,
            storeBilled: isStoreProvider(workspace?.billing_provider),
            signedUpAt: user.signed_up_at ? new Date(user.signed_up_at) : null,
            onboardingCompletedAt: workspace?.onboarded_at ? new Date(workspace.onboarded_at) : null,
            trialEndsAt: workspace?.trial_ends_at ? new Date(workspace.trial_ends_at) : null,
            subscriptionEntitled: isMachineEntitled(workspace?.subscription_status),
            trialLapsed: !!workspace && isTrialLapsed(workspace.subscription_status, workspace.first_paid_at),
            trialPaymentFailed: workspace?.subscription_status === 'past_due',
            subscriptionPaid: isPaidSubscription(workspace?.subscription_status),
            subscriptionCancelAt: workspace?.subscription_cancel_at ? new Date(workspace.subscription_cancel_at) : null,
            boxesArchivedAt: workspace?.boxes_archived_at ? new Date(workspace.boxes_archived_at) : null,
            pausedArchive: expiringArchives.get(user.workspace_id) ?? null,
            renewalReminderAt: workspace?.renewal_reminder_at && workspace.renewal_reminder_user_id === user.id ? new Date(workspace.renewal_reminder_at) : null,
            memberCount: memberCounts.get(user.workspace_id) ?? 1,
            agentCount: agentCounts.get(user.workspace_id) ?? 0,
            firstSuccessfulRunAt: runs.firstSuccessByWorkspace.get(user.workspace_id) ?? null,
            successfulRuns: runs.successesByWorkspace.get(user.workspace_id) ?? 0,
            idleAgents: idleAgents.get(user.workspace_id) ?? [],
            habitAgents: habitAgentsFor(runs, confirmedHabit, agentNames, user.workspace_id),
            recommendationCount: templates ? shortlistTemplates(templates, recommendContext(answers, now)).length : 0,
            sent: sendsFor(sent, user.id, user.workspace_id),
            wantsProduct: wantsCategoryEmail(user.email_notification_prefs, 'product'),
            wantsBilling: wantsCategoryEmail(user.email_notification_prefs, 'billing'),
        } satisfies LifecycleSnapshot
    })

    return { snapshots, users: new Map(users.map(user => [user.id, user])), workspaces, agentNames }
}
