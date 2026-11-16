import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'
import { createWorkspaceInvite } from '@/app/api/_services/workspace-invite.service'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { dispatchForemanOverviewTool } from './overview-tools'

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_auth/access', async importOriginal => ({ ...(await importOriginal<object>()), visibleSpaceIds: vi.fn(async (actor: Actor) => (actor.kind === 'user' && actor.role === 'member' ? new Set(['box-a']) : 'all')) }))
vi.mock('@/app/api/_auth/ownership', () => ({ workspaceFounderUserId: vi.fn(async () => 'founder') }))
vi.mock('@/app/api/_services/ai-status-hub.service', () => ({ readRerunCredit: vi.fn(async () => ({ credit: { remainingMicros: 12_500_000, usedMicros: 7_500_000, totalMicros: 20_000_000, paused: false, resetsAt: '2026-12-01T00:00:00Z' } })) }))
vi.mock('@/app/api/_services/getting-started.service', () => ({ readGettingStartedItems: vi.fn(async () => new Set(['first_agent', 'invite'])) }))
vi.mock('@/app/api/_services/members.service', () => ({ resolveMemberIdentities: vi.fn(async () => new Map([['admin-1', { email: 'ada@acme.test', name: 'Ada', avatarUrl: null }], ['member-1', { email: 'bob@acme.test', name: 'Bob', avatarUrl: null }]])) }))
vi.mock('@/app/api/_services/vault.service', () => ({ listVault: vi.fn(async () => ({ entries: [{ id: 'item-1', name: 'Gmail', label: 'ada@acme.test', status: 'needs_auth' }, { id: 'item-2', name: 'Notion', status: 'active' }] })) }))
vi.mock('@/app/api/_services/workspace-invite.service', () => ({ createWorkspaceInvite: vi.fn(async ({ email }: { email: string }) => (email.startsWith('full') ? { ok: false, email, code: 'seatLimit' } : { ok: true, email })) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn(() => ({ auth: { admin: { getUserById: async () => ({ data: { user: { email: 'ada@acme.test' } } }) } } })) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMany: vi.fn(), selectMaybeSingle: vi.fn() }))

const admin: Actor = { kind: 'user', userId: 'admin-1', workspaceId: 7, role: 'admin', boxScope: 'all' }
const member: Actor = { kind: 'user', userId: 'member-1', workspaceId: 7, role: 'member', boxScope: 'assigned' }

const AGENTS = [
    { id: 'scout', name: 'Scout', space_id: 'box-a', disabled_at: null, disabled_reason: null },
    { id: 'closer', name: 'Closer', space_id: 'box-b', disabled_at: '2026-11-15T00:00:00Z', disabled_reason: 'plan' },
]

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(selectMany).mockImplementation(async (_client, table, _columns, filter) => {
        const f = filter as Record<string, unknown>
        if (table === 'agents') return { data: AGENTS } as never
        if (table === 'sessions') {
            const ids = f.agent_id as string[]
            const rows = f.status === 'error' ? [{ agent_id: 'closer', title: 'Morning report', status: 'error', updated_at: '2026-11-16T07:00:00Z' }] : [{ agent_id: 'scout', title: 'Send the drafts', status: 'awaiting_approval', updated_at: '2026-11-10T09:00:00Z' }]
            return { data: rows.filter(row => ids.includes(row.agent_id)) } as never
        }
        if (table === 'workspace_members') return { data: [{ user_id: 'admin-1', role: 'admin' }, { user_id: 'member-1', role: 'member' }] } as never
        if (table === 'users') return { data: [{ id: 'admin-1', last_active_at: '2026-11-16T09:00:00Z' }, { id: 'member-1', last_active_at: null }] } as never
        if (table === 'workspace_invitations') return { data: [{ email: 'carol@acme.test', created_at: 'x', expires_at: 'y' }] } as never
        return { data: [] } as never
    })
    vi.mocked(selectMaybeSingle).mockResolvedValue({ data: { id: 7, name: 'Acme', max_seats: 5, subscription_status: 'trialing', trial_ends_at: '2026-11-30T00:00:00Z' } } as never)
})

const overview = (actor: Actor, args: Record<string, unknown> = {}, wake = false) => dispatchForemanOverviewTool(actor, 'workspace_overview', args, { wake }) as Promise<Record<string, any>>

describe('workspace_overview', () => {
    it('reads every section at once, waiting conversations however old', async () => {
        const out = await overview(admin)
        expect(Object.keys(out).sort()).toEqual(['attention', 'getting_started', 'invites', 'members', 'usage'])
        expect(out.attention.waiting).toEqual([{ coworker: 'Scout', coworkerId: 'scout', conversation: 'Send the drafts', status: 'awaiting_approval', since: '2026-11-10T09:00:00Z' }])
        expect(out.attention.failed.map((row: { coworker: string }) => row.coworker)).toEqual(['Closer'])
        expect(out.attention.paused).toEqual([{ coworker: 'Closer', coworkerId: 'closer', reason: 'plan' }])
        expect(out.attention.signedOutApps).toEqual([{ id: 'item-1', name: 'Gmail', account: 'ada@acme.test' }])
        expect(out.usage).toMatchObject({ subscription: 'trialing', trialEndsAt: '2026-11-30T00:00:00Z', rerunCredit: { remainingUsd: 12.5 } })
        expect(out.getting_started).toMatchObject({ first_agent: true, invite: true, schedule: false })
    })

    it('reads only the sections asked for', async () => {
        expect(Object.keys(await overview(admin, { sections: ['usage'] }))).toEqual(['usage'])
    })

    // It only shows what the person it speaks for can see.
    it('keeps the coworkers of Boxes the member does not see out', async () => {
        const out = await overview(member)
        expect(out.attention.failed).toEqual([])
        expect(out.attention.paused).toEqual([])
        expect(out.attention.waiting.map((row: { coworker: string }) => row.coworker)).toEqual(['Scout'])
    })

    it('names members by first name and never by address', async () => {
        const out = await overview(admin)
        expect(out.members).toEqual([
            { memberId: 'admin-1', name: 'Ada', role: 'admin', lastActiveAt: '2026-11-16T09:00:00Z' },
            { memberId: 'member-1', name: 'Bob', role: 'member', lastActiveAt: null },
        ])
        expect(JSON.stringify(out.members)).not.toContain('@')
    })

    it('shows pending invitations by address to an admin in a conversation only', async () => {
        expect((await overview(admin)).invites).toEqual({ pending: 1, emails: ['carol@acme.test'] })
        expect((await overview(admin, {}, true)).invites).toEqual({ pending: 1 })
        expect((await overview(member)).invites).toEqual({ pending: 1 })
    })
})

describe('invite_members', () => {
    it('invites each address an admin named, and says which could not be', async () => {
        const out = (await dispatchForemanOverviewTool(admin, 'invite_members', { emails: ['bob@acme.test', 'full@acme.test', 'bob@acme.test'] })) as { invites: unknown[] }
        expect(out.invites).toEqual([
            { email: 'bob@acme.test', invited: true },
            { email: 'full@acme.test', invited: false, reason: 'seatLimit' },
        ])
        expect(createWorkspaceInvite).toHaveBeenCalledWith(expect.objectContaining({ inviterId: 'admin-1', inviterEmail: 'ada@acme.test', boxScope: 'all' }))
    })

    it('refuses a member, an empty list and more than ten addresses', async () => {
        await expect(dispatchForemanOverviewTool(member, 'invite_members', { emails: ['a@b.co'] })).rejects.toThrow('Only an admin')
        await expect(dispatchForemanOverviewTool(admin, 'invite_members', { emails: [] })).rejects.toThrow('addresses')
        await expect(dispatchForemanOverviewTool(admin, 'invite_members', { emails: Array.from({ length: 11 }, (_, i) => `p${i}@acme.test`) })).rejects.toThrow('At most 10')
        expect(createWorkspaceInvite).not.toHaveBeenCalled()
    })
})
