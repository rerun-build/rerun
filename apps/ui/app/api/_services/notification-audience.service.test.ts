import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ selectMaybeSingle: vi.fn(), update: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({ from: () => ({ update: mocks.update }) }) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: mocks.selectMaybeSingle }))

const { followAuthorOfCreatedTask } = await import('./notification-audience.service')

type Row = Record<string, unknown> | null

function rows({ member, agent, prefs = { version: 2, coworkers: {} } }: { member: Row; agent?: Row; prefs?: unknown }) {
    mocks.selectMaybeSingle.mockImplementation(async (_client: unknown, table: string) => {
        if (table === 'workspace_members') return { data: member }
        if (table === 'agents') return { data: agent ?? null }
        return { data: { email_notification_prefs: prefs } }
    })
}

const followedIds = () => mocks.update.mock.calls.flatMap(([patch]) => Object.entries((patch as { email_notification_prefs: { coworkers: Record<string, { follow?: boolean }> } }).email_notification_prefs.coworkers).flatMap(([id, rule]) => (rule.follow ? [id] : [])))
const scheduleBy = (agentId: string, authorId: string) => ({ event: 'agent.schedule.created' as const, agentId, metadata: { scheduleSlug: 'weekly', authorId } })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.update.mockReturnValue({ eq: async () => ({ error: null }) })
})

describe('followAuthorOfCreatedTask', () => {
    // The foreman has no agent row: the member who asked it for a routine still has to follow it,
    // or a run of that routine opens its thread for somebody else.
    it('makes the member who asked the Chief of Staff for a routine follow it, with no agent row read', async () => {
        rows({ member: { user_id: 'asker' } })
        await followAuthorOfCreatedTask(7, scheduleBy('foreman', 'asker'))
        expect(followedIds()).toEqual(['foreman'])
        expect(mocks.selectMaybeSingle.mock.calls.map(call => call[1])).not.toContain('agents')
    })

    it('follows nothing for an author who is not a member of the workspace', async () => {
        rows({ member: null })
        await followAuthorOfCreatedTask(7, scheduleBy('foreman', 'outsider'))
        expect(mocks.update).not.toHaveBeenCalled()
    })

    it('leaves a member who stopped following the Chief of Staff alone', async () => {
        rows({ member: { user_id: 'asker' }, prefs: { version: 2, coworkers: { foreman: { mode: 'default', follow: false } } } })
        await followAuthorOfCreatedTask(7, scheduleBy('foreman', 'asker'))
        expect(mocks.update).not.toHaveBeenCalled()
    })

    it("still follows a coworker under its row's id, and nothing when the box names one the workspace does not hold", async () => {
        rows({ member: { user_id: 'asker' }, agent: { id: 'agent-1' } })
        await followAuthorOfCreatedTask(7, scheduleBy('engine-1', 'asker'))
        expect(followedIds()).toEqual(['agent-1'])

        mocks.update.mockClear()
        rows({ member: { user_id: 'asker' }, agent: null })
        await followAuthorOfCreatedTask(7, scheduleBy('engine-gone', 'asker'))
        expect(mocks.update).not.toHaveBeenCalled()
    })
})
