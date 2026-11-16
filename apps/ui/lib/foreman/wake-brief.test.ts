import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memberActor, visibleSpaceIds } from '@/app/api/_auth/access'
import { memberWorkspaceContext, workspaceFounderUserId } from '@/app/api/_auth/ownership'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { verifyForemanHubToken } from './hub-token'
import { loadForemanState } from './state'
import { foremanWakeBrief, isDormant, wakesOpenTo } from './wake-brief'

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_auth/access', () => ({ memberActor: vi.fn(), visibleSpaceIds: vi.fn() }))
vi.mock('@/app/api/_auth/ownership', () => ({ memberWorkspaceContext: vi.fn(), workspaceFounderUserId: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMany: vi.fn(), selectMaybeSingle: vi.fn() }))
vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), isSubscriptionEntitled: (status: string | null) => status === 'active' || status === 'trialing' }))
vi.mock('./state', () => ({ loadForemanState: vi.fn() }))
vi.mock('./prompt', () => ({ foremanWakeInstructions: () => 'Charter of a wake' }))

const WORKSPACE = 7
const NOW = Date.parse('2026-11-16T10:00:00Z')
const DAY = 24 * 60 * 60 * 1000

let workspaceRow: Record<string, unknown> | null
let lastActive: string | null

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('FOREMAN_HUB_TOKEN_SECRET', 'test-secret')
    vi.stubEnv('FOREMAN_WAKE_WORKSPACES', '3, 7')
    workspaceRow = { is_sandbox: false, subscription_status: 'active', assistant_proactive: true }
    lastActive = new Date(NOW - DAY).toISOString()
    vi.mocked(selectMaybeSingle).mockImplementation(async (_client, table) => (table === 'workspaces' ? { data: workspaceRow } : { data: { timezone: 'Europe/Paris' } }) as never)
    vi.mocked(selectMany).mockImplementation(async (_client, table) => (table === 'workspace_members' ? { data: [{ user_id: 'founder' }, { user_id: 'member-1' }] } : { data: [{ last_active_at: lastActive }, { last_active_at: null }] }) as never)
    vi.mocked(workspaceFounderUserId).mockResolvedValue('founder')
    vi.mocked(memberActor).mockResolvedValue({ kind: 'user', userId: 'member-1', workspaceId: WORKSPACE, role: 'admin', boxScope: 'all' })
    vi.mocked(visibleSpaceIds).mockResolvedValue('all')
    vi.mocked(memberWorkspaceContext).mockImplementation(async (_ws, userId) => ({ userId, supabase: {} }) as never)
    vi.mocked(loadForemanState).mockResolvedValue({} as never)
})

afterEach(() => vi.unstubAllEnvs())

const ask = (over: Record<string, unknown> = {}) => foremanWakeBrief(WORKSPACE, { reason: 'mandatory', memberId: 'member-1', provider: 'claude', ...over }, NOW)

describe('foremanWakeBrief', () => {
    it('briefs the member the signal concerns, with a token that only reads', async () => {
        const out = await ask()
        if (!('brief' in out)) throw new Error(`skipped: ${out.skip}`)
        expect(out.memberId).toBe('member-1')
        expect(out.timezone).toBe('Europe/Paris')
        expect(out.brief.instructions).toBe('Charter of a wake')
        expect(out.brief.builtins).toEqual(['schedule_wake'])
        expect(verifyForemanHubToken(out.brief.hubToken, WORKSPACE, NOW)).toMatchObject({ uid: 'member-1', scope: 'wake' })
        expect(memberWorkspaceContext).toHaveBeenCalledWith(WORKSPACE, 'member-1')
    })

    // The box cannot keep a Box from the run: a member who sees only some of them is not written to.
    it('writes to the founder when the member sees only some Boxes, has left, or is not named', async () => {
        vi.mocked(visibleSpaceIds).mockResolvedValueOnce(new Set(['box-a']))
        expect(await ask()).toMatchObject({ memberId: 'founder' })
        vi.mocked(memberActor).mockResolvedValueOnce(null)
        expect(await ask()).toMatchObject({ memberId: 'founder' })
        expect(await ask({ memberId: null })).toMatchObject({ memberId: 'founder' })
    })

    it('hands out only read tools and no board gesture', async () => {
        const out = await ask()
        if (!('brief' in out)) throw new Error('skipped')
        expect(out.brief.tools.every(tool => tool.kind === 'hub')).toBe(true)
        const names = out.brief.tools.map(tool => tool.name)
        expect(names).toContain('get_team_status')
        for (const write of ['create_agent', 'delete_agent', 'send_message', 'set_vault_link', 'focus_agent', 'analyze_website']) expect(names).not.toContain(write)
    })

    it.each([
        ['no_token_secret', () => vi.stubEnv('FOREMAN_HUB_TOKEN_SECRET', '')],
        ['sandbox', () => (workspaceRow = { ...workspaceRow, is_sandbox: true })],
        ['disabled', () => (workspaceRow = { ...workspaceRow, assistant_proactive: false })],
        ['not_released', () => vi.stubEnv('FOREMAN_WAKE_WORKSPACES', '3')],
        ['no_plan', () => (workspaceRow = { ...workspaceRow, subscription_status: 'canceled' })],
        ['no_member', () => vi.mocked(workspaceFounderUserId).mockResolvedValue(null) && vi.mocked(memberActor).mockResolvedValue(null)],
    ])('stays asleep: %s', async (reason, arrange) => {
        arrange()
        expect(await ask()).toEqual({ skip: reason })
    })

    it('keeps a wake on Codex asleep until its sandbox is proven on a box', async () => {
        expect(await ask({ provider: 'codex' })).toEqual({ skip: 'provider' })
    })

    it('wakes once a week in a workspace nobody opened for a week', async () => {
        lastActive = new Date(NOW - 8 * DAY).toISOString()
        expect(await ask({ lastWakeAt: new Date(NOW - 2 * DAY).toISOString() })).toEqual({ skip: 'dormant' })
        expect(await ask({ lastWakeAt: new Date(NOW - 8 * DAY).toISOString() })).toHaveProperty('brief')
    })
})

describe('isDormant', () => {
    it('is awake while someone opened the app this week', () => {
        expect(isDormant(NOW - DAY, new Date(NOW - DAY).toISOString(), NOW)).toBe(false)
    })

    it('sleeps between weekly wakes once nobody came for a week, and never before the first wake', () => {
        expect(isDormant(NOW - 8 * DAY, new Date(NOW - DAY).toISOString(), NOW)).toBe(true)
        expect(isDormant(null, new Date(NOW - DAY).toISOString(), NOW)).toBe(true)
        expect(isDormant(NOW - 8 * DAY, null, NOW)).toBe(false)
        expect(isDormant(NOW - 8 * DAY, new Date(NOW - 7 * DAY).toISOString(), NOW)).toBe(false)
    })
})

describe('wakesOpenTo', () => {
    it('opens the workspaces of the internal wave only', () => {
        expect(wakesOpenTo(7)).toBe(true)
        expect(wakesOpenTo(70)).toBe(false)
    })
})
