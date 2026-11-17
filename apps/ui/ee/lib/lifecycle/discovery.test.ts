import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type SupabaseCall } from '@/test/supabase-fake'
import { loadLifecycleContext } from './discovery'

vi.mock('@/lib/templates/recommend', () => ({ loadRecommendCandidates: vi.fn().mockResolvedValue([]), recommendContext: vi.fn(), shortlistTemplates: vi.fn().mockReturnValue([]) }))

const NOW = new Date('2026-09-20T12:00:00.000Z')
const HOUR = 60 * 60_000
const DAY = 24 * HOUR

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

type Row = Record<string, unknown>
type Tables = Partial<Record<'users' | 'workspaces' | 'workspace_onboarding' | 'workspace_members' | 'agents' | 'notifications' | 'lifecycle_emails' | 'workspace_archives', Row[]>>

function compare(value: unknown, bound: unknown, test: (a: string | number, b: string | number) => boolean) {
    return value !== null && value !== undefined && test(value as string | number, bound as string | number)
}

// A tiny PostgREST: applies the filters the helpers emit to an in-memory table, so the bounds that
// the module applies itself in TypeScript are exercised against rows the query really returned.
function matches(row: Row, calls: readonly SupabaseCall[]): boolean {
    return calls.every(({ method, args: [column, value] }) => {
        const cell = row[column as string]
        switch (method) {
            case 'eq':
                return cell === value
            case 'in':
                return (value as unknown[]).includes(cell)
            case 'gte':
                return compare(cell, value, (a, b) => a >= b)
            case 'lte':
                return compare(cell, value, (a, b) => a <= b)
            case 'is':
                return cell === null || cell === undefined
            case 'not':
                return cell !== null && cell !== undefined
            default:
                return true
        }
    })
}

// PostgREST's `max_rows`: whatever `limit` or `range` asks, one response holds at most this many rows.
const MAX_ROWS = 1000

function ordered(rows: Row[], calls: readonly SupabaseCall[]): Row[] {
    const order = calls.find(call => call.method === 'order')
    if (!order) return rows
    const [column, options] = order.args as [string, { ascending?: boolean } | undefined]
    const direction = options?.ascending === false ? -1 : 1
    return [...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -direction : String(a[column]) > String(b[column]) ? direction : 0))
}

function page(rows: Row[], calls: readonly SupabaseCall[]): Row[] {
    const range = calls.find(call => call.method === 'range')
    const limit = calls.find(call => call.method === 'limit')
    const [from, to] = range ? (range.args as [number, number]) : [0, limit ? (limit.args[0] as number) - 1 : Infinity]
    return rows.slice(from, Math.min(to + 1, from + MAX_ROWS))
}

function database(tables: Tables) {
    return fakeSupabase((table, calls) => {
        const rows = (tables[table as keyof Tables] ?? []).filter(row => matches(row, calls))
        return { data: page(ordered(rows, calls), calls), count: rows.length }
    })
}

function workspace(id: number, overrides: Row = {}): Row {
    return { id, name: `ws ${id}`, is_sandbox: false, trial_ends_at: null, subscription_status: 'active', subscription_cancel_at: null, first_paid_at: '2026-01-01T00:00:00.000Z', stripe_customer_id: null, onboarded_at: '2026-02-01T00:00:00.000Z', ...overrides }
}

function user(id: string, workspaceId: number, overrides: Row = {}): Row {
    return { id, workspace_id: workspaceId, signed_up_at: '2026-02-01T00:00:00.000Z', email_notification_prefs: null, ...overrides }
}

function member(workspaceId: number, userId: string, createdAt: string): Row {
    return { workspace_id: workspaceId, user_id: userId, created_at: createdAt }
}

describe('loadLifecycleContext', () => {
    beforeEach(() => vi.stubEnv('LIFECYCLE_EMAILS_START_AT', '2026-01-01T00:00:00.000Z'))
    afterEach(() => vi.unstubAllEnvs())

    it('returns nothing and reads no user when there is no candidate', async () => {
        const db = database({})

        const context = await loadLifecycleContext(db.client, NOW)

        expect(context.snapshots).toEqual([])
        expect(db.chainsOn('workspace_members')).toEqual([])
    })

    it('reaches a candidate workspace through its founder only', async () => {
        const db = database({
            workspaces: [workspace(1, { trial_ends_at: at(12 * HOUR), subscription_status: 'trialing', first_paid_at: null })],
            workspace_members: [member(1, 'founder', '2026-02-01T00:00:00.000Z'), member(1, 'colleague', '2026-03-01T00:00:00.000Z')],
            users: [user('founder', 1), user('colleague', 1)],
        })

        const { snapshots } = await loadLifecycleContext(db.client, NOW)

        expect(snapshots).toHaveLength(1)
        expect(snapshots[0]).toMatchObject({ userId: 'founder', isFounder: true, memberCount: 2 })
    })

    it('counts one member when the membership rows are missing', async () => {
        const db = database({
            users: [user('fresh', 5, { signed_up_at: at(-30 * HOUR) })],
            workspaces: [workspace(5)],
        })

        const { snapshots } = await loadLifecycleContext(db.client, NOW)

        expect(snapshots[0]).toMatchObject({ userId: 'fresh', memberCount: 1, isFounder: false })
    })

    it('applies the subscription horizon itself', async () => {
        const db = database({
            workspaces: [workspace(10, { subscription_cancel_at: at(3 * DAY) }), workspace(11, { subscription_cancel_at: at(20 * DAY) })],
            workspace_members: [member(10, 'soon', '2026-02-01T00:00:00.000Z'), member(11, 'later', '2026-02-01T00:00:00.000Z')],
            users: [user('soon', 10), user('later', 11)],
        })

        const { snapshots } = await loadLifecycleContext(db.client, NOW)

        expect(snapshots.map(snapshot => snapshot.userId)).toEqual(['soon'])
    })

    it('reaches whoever asked for a due renewal reminder, and only them', async () => {
        const db = database({
            workspaces: [
                workspace(30, { renewal_reminder_at: at(-HOUR), renewal_reminder_user_id: 'asker' }),
                workspace(31, { renewal_reminder_at: at(2 * DAY), renewal_reminder_user_id: 'early' }),
            ],
            workspace_members: [member(30, 'founder', '2026-02-01T00:00:00.000Z'), member(30, 'asker', '2026-03-01T00:00:00.000Z'), member(31, 'early', '2026-02-01T00:00:00.000Z')],
            users: [user('founder', 30), user('asker', 30), user('early', 31)],
        })

        const { snapshots } = await loadLifecycleContext(db.client, NOW)

        expect(snapshots.map(snapshot => snapshot.userId)).toEqual(['asker'])
        expect(snapshots[0]).toMatchObject({ isFounder: false, renewalReminderAt: new Date(at(-HOUR)) })
    })

    it('keeps a trial ending within a day or ended within the window, and drops the rest', async () => {
        const trial = (id: number, endsAt: string) => workspace(id, { trial_ends_at: endsAt, subscription_status: 'trialing', first_paid_at: null })
        const db = database({
            workspaces: [trial(20, at(-HOUR)), trial(21, at(-10 * DAY)), trial(22, at(12 * HOUR)), trial(23, at(3 * DAY))],
            workspace_members: [20, 21, 22, 23].map(id => member(id, `u${id}`, '2026-02-01T00:00:00.000Z')),
            users: [20, 21, 22, 23].map(id => user(`u${id}`, id)),
        })

        const { snapshots } = await loadLifecycleContext(db.client, NOW)

        expect(snapshots.map(snapshot => snapshot.workspaceId).sort()).toEqual([20, 22])
    })

    it('brings in a paused workspace with an archive expiring this week, carrying its current archive', async () => {
        const archive = (workspaceId: number, archivedAt: string, expiresAt: string) => ({ workspace_id: workspaceId, archived_at: archivedAt, expires_at: expiresAt })
        const lapsed = (id: number) => workspace(id, { subscription_status: 'canceled', boxes_archived_at: at(-85 * DAY) })
        const db = database({
            workspaces: [lapsed(30), lapsed(31), lapsed(32)],
            workspace_archives: [
                archive(30, at(-85 * DAY), at(5 * DAY)),
                // Paused, restored, paused again: the older archive is expiring, the current one is not.
                archive(31, at(-85 * DAY), at(5 * DAY)),
                archive(31, at(-10 * DAY), at(80 * DAY)),
                archive(32, at(-60 * DAY), at(30 * DAY)),
            ],
            workspace_members: [30, 31, 32].map(id => member(id, `u${id}`, '2026-02-01T00:00:00.000Z')),
            users: [30, 31, 32].map(id => user(`u${id}`, id)),
        })

        const { snapshots } = await loadLifecycleContext(db.client, NOW)

        expect(snapshots.map(snapshot => snapshot.workspaceId).sort()).toEqual([30, 31])
        expect(snapshots.find(snapshot => snapshot.workspaceId === 30)).toMatchObject({ boxesArchivedAt: new Date(at(-85 * DAY)), pausedArchive: { archivedAt: new Date(at(-85 * DAY)), expiresAt: new Date(at(5 * DAY)) } })
        expect(snapshots.find(snapshot => snapshot.workspaceId === 31)?.pausedArchive).toEqual({ archivedAt: new Date(at(-10 * DAY)), expiresAt: new Date(at(80 * DAY)) })
    })

    it('narrows the sweep to the users asked for', async () => {
        const db = database({
            users: [user('a', 1, { signed_up_at: at(-30 * HOUR) }), user('b', 2, { signed_up_at: at(-30 * HOUR) })],
            workspaces: [workspace(1), workspace(2)],
        })

        const { snapshots } = await loadLifecycleContext(db.client, NOW, ['b'])

        expect(snapshots.map(snapshot => snapshot.userId)).toEqual(['b'])
    })

    it('lists as idle only the young agents that never completed a run', async () => {
        const db = database({
            agents: [
                { id: 'idle', workspace_id: 1, name: 'Idle', created_at: at(-30 * HOUR), disabled_at: null, kind: 'coworker' },
                { id: 'busy', workspace_id: 1, name: 'Busy', created_at: at(-30 * HOUR), disabled_at: null, kind: 'coworker' },
                { id: 'chief', workspace_id: 1, name: 'Chief of Staff', created_at: at(-30 * HOUR), disabled_at: null, kind: 'foreman' },
            ],
            notifications: [{ agent_id: 'busy', workspace_id: 1, event: 'agent.schedule.completed', kind: 'done', source: 'schedule', created_at: at(-HOUR) }],
            workspace_members: [member(1, 'owner', '2026-02-01T00:00:00.000Z')],
            users: [user('owner', 1)],
            workspaces: [workspace(1)],
        })

        const { snapshots } = await loadLifecycleContext(db.client, NOW)

        expect(snapshots[0].idleAgents.map(agent => agent.id)).toEqual(['idle'])
        expect(snapshots[0].agentCount).toBe(2)
        expect(snapshots[0].successfulRuns).toBe(1)
    })

    it('reads the onboarding of the workspace, so a member invited into a running one owes none', async () => {
        const db = database({
            users: [user('invited', 7, { signed_up_at: at(-30 * HOUR) })],
            workspaces: [workspace(7, { onboarded_at: '2026-03-01T00:00:00.000Z' })],
            workspace_members: [member(7, 'founder', '2026-02-01T00:00:00.000Z'), member(7, 'invited', at(-30 * HOUR))],
        })

        const { snapshots } = await loadLifecycleContext(db.client, NOW, ['invited'])

        expect(snapshots[0]).toMatchObject({ userId: 'invited', isFounder: false, onboardingCompletedAt: new Date('2026-03-01T00:00:00.000Z') })
    })

    it('reaches the founder of a freshly onboarded workspace, with its answers', async () => {
        const answers = { company_name: 'Acme', industry: 'sales' }
        const db = database({
            workspaces: [workspace(8, { onboarded_at: at(-30 * HOUR) })],
            workspace_onboarding: [{ workspace_id: 8, answers }],
            workspace_members: [member(8, 'founder', '2026-02-01T00:00:00.000Z')],
            users: [user('founder', 8)],
        })

        const context = await loadLifecycleContext(db.client, NOW)

        expect(context.snapshots).toHaveLength(1)
        expect(context.snapshots[0]).toMatchObject({ userId: 'founder', isFounder: true, onboardingCompletedAt: new Date(at(-30 * HOUR)) })
        expect(context.workspaces.get(8)?.onboarding_answers).toEqual(answers)
    })

    it('treats a user whose workspace row is missing as a sandbox', async () => {
        const db = database({ users: [user('orphan', 404, { signed_up_at: at(-30 * HOUR) })] })

        const { snapshots } = await loadLifecycleContext(db.client, NOW)

        expect(snapshots[0]).toMatchObject({ isSandbox: true, trialLapsed: false })
    })

    it('does not call idle a young agent whose only run lies past the first thousand rows read', async () => {
        const run = (id: string, agentId: string) => ({ id, agent_id: agentId, workspace_id: 1, event: 'agent.message.completed', kind: 'done', source: null, created_at: at(-2 * DAY) })
        const db = database({
            agents: [
                { id: 'busy', workspace_id: 1, name: 'Busy', created_at: at(-30 * HOUR), disabled_at: null, kind: 'coworker' },
                { id: 'late', workspace_id: 1, name: 'Late', created_at: at(-30 * HOUR), disabled_at: null, kind: 'coworker' },
            ],
            notifications: [...Array.from({ length: 1200 }, (_, i) => run(`n-${String(i).padStart(4, '0')}`, 'busy')), run('n-9999', 'late')],
            workspace_members: [member(1, 'owner', '2026-02-01T00:00:00.000Z')],
            users: [user('owner', 1)],
            workspaces: [workspace(1)],
        })

        const { snapshots } = await loadLifecycleContext(db.client, NOW)

        expect(snapshots[0].idleAgents).toEqual([])
    })

    it('counts every agent and member of a workspace past the first thousand rows', async () => {
        const db = database({
            workspaces: [workspace(1, { trial_ends_at: at(12 * HOUR), subscription_status: 'trialing', first_paid_at: null })],
            agents: Array.from({ length: 1500 }, (_, i) => ({ id: `agent-${String(i).padStart(4, '0')}`, workspace_id: 1, name: `Agent ${i}`, created_at: '2026-02-01T00:00:00.000Z', disabled_at: null, kind: 'coworker' })),
            workspace_members: [member(1, 'founder', '2026-02-01T00:00:00.000Z'), ...Array.from({ length: 1100 }, (_, i) => member(1, `member-${i}`, `2026-03-01T00:00:00.${String(i).padStart(3, '0')}Z`))],
            users: [user('founder', 1)],
        })

        const { snapshots } = await loadLifecycleContext(db.client, NOW)

        expect(snapshots[0]).toMatchObject({ userId: 'founder', isFounder: true, agentCount: 1500, memberCount: 1101 })
    })

    it('scans the run log up to its own limit, past the thousand rows one response holds', async () => {
        const run = (id: number, workspaceId: number, createdAt: string) => ({ id: `n-${id}`, agent_id: `agent-${workspaceId}`, workspace_id: workspaceId, event: 'agent.message.completed', kind: 'done', source: 'schedule', created_at: createdAt })
        const busy = Array.from({ length: 1200 }, (_, i) => run(i, 1, at(-HOUR - i * 1000)))
        const db = database({
            notifications: [...busy, run(9999, 2, at(-3 * DAY))],
            workspaces: [workspace(1), workspace(2)],
            workspace_members: [member(1, 'busy-owner', '2026-02-01T00:00:00.000Z'), member(2, 'quiet-owner', '2026-02-01T00:00:00.000Z')],
            users: [user('busy-owner', 1), user('quiet-owner', 2)],
        })

        const { snapshots } = await loadLifecycleContext(db.client, NOW)

        expect(snapshots.find(snapshot => snapshot.userId === 'busy-owner')?.successfulRuns).toBe(1200)
        expect(snapshots.find(snapshot => snapshot.userId === 'quiet-owner')?.firstSuccessfulRunAt).toEqual(new Date(at(-3 * DAY)))
    })
})
