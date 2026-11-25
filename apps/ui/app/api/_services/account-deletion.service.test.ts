import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, writeMethodOf, type FakeSupabase, type SupabaseCall } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({
    subscriptionStillCharges: vi.fn(),
    stopWorkspaceCharges: vi.fn(),
    uninstallWorkspaceApps: vi.fn(),
    listAvatars: vi.fn(),
    removeAvatars: vi.fn(),
    revokeMemberComputers: vi.fn(async () => {}),
    leaveOrganizations: vi.fn(async () => {}),
}))

vi.mock('@/app/api/_services/remote-computers.service', () => ({ revokeMemberComputers: mocks.revokeMemberComputers }))
vi.mock('@rerun/cloud/organizations.server', () => ({ leaveOrganizations: mocks.leaveOrganizations }))
vi.mock('@rerun/cloud/account', () => ({ subscriptionStillCharges: mocks.subscriptionStillCharges, stopWorkspaceCharges: mocks.stopWorkspaceCharges, uninstallWorkspaceApps: mocks.uninstallWorkspaceApps }))

const { accountDeletionBlockers, anonymizeAccount, ACCOUNT_DELETED_REASON } = await import('./account-deletion.service')

const USER = 'user-leaving'
const TEAMMATE = 'user-staying'

type WorkspaceRow = { id: number; name: string; is_sandbox: boolean; stripe_customer_id: string | null; stripe_subscription_id: string | null; subscription_status: string | null; organization_id?: string | null }

const SHARED: WorkspaceRow = { id: 1, name: 'Acme', is_sandbox: false, stripe_customer_id: 'cus_acme', stripe_subscription_id: 'sub_acme', subscription_status: 'active' }
const OWN: WorkspaceRow = { id: 2, name: 'Side project', is_sandbox: false, stripe_customer_id: 'cus_side', stripe_subscription_id: 'sub_side', subscription_status: 'trialing' }

const filtersOn = (calls: readonly SupabaseCall[], column: string) => calls.some(call => (call.method === 'eq' || call.method === 'in') && call.args[0] === column)

type MemberRow = { workspace_id: number; user_id: string; role?: 'admin' | 'member'; organization_staff?: boolean }

function membersMatching(members: MemberRow[], calls: readonly SupabaseCall[]) {
    const rows = members.map(member => ({ role: 'admin', organization_staff: false, ...member }) as Record<string, unknown>)
    const matching = rows.filter(row =>
        calls.every(call => {
            if (call.method === 'eq') return row[call.args[0] as string] === call.args[1]
            if (call.method === 'neq') return row[call.args[0] as string] !== call.args[1]
            if (call.method === 'in') return (call.args[1] as unknown[]).includes(row[call.args[0] as string])
            return true
        }),
    )
    if ((calls.find(call => call.method === 'select')?.args[1] as { head?: boolean } | undefined)?.head) return { count: matching.length }
    if (calls.some(call => call.method === 'maybeSingle')) return { data: matching[0] ?? null }
    return { data: matching }
}

function world(workspaces: WorkspaceRow[], members: MemberRow[]): FakeSupabase {
    const db = fakeSupabase((table, calls) => {
        if (writeMethodOf(calls) || table.startsWith('rpc:')) return undefined
        if (table === 'workspace_members') return membersMatching(members, calls)
        if (table === 'workspaces') return { data: workspaces }
        return undefined
    })
    Object.assign(db.client, { storage: { from: () => ({ list: mocks.listAvatars, remove: mocks.removeAvatars }) } })
    return db
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.stopWorkspaceCharges.mockResolvedValue(undefined)
    mocks.uninstallWorkspaceApps.mockResolvedValue(undefined)
    mocks.subscriptionStillCharges.mockResolvedValue(false)
    mocks.listAvatars.mockResolvedValue({ data: [{ name: 'a.webp' }], error: null })
    mocks.removeAvatars.mockResolvedValue({ data: [], error: null })
})

describe('accountDeletionBlockers', () => {
    it('names a workspace only this user is in whose plan still renews', async () => {
        mocks.subscriptionStillCharges.mockResolvedValue(true)
        const db = world([OWN], [{ workspace_id: OWN.id, user_id: USER }])

        await expect(accountDeletionBlockers(db.client, USER)).resolves.toEqual([{ workspaceId: OWN.id, name: OWN.name }])
    })

    it('lets a workspace whose plan no longer charges go', async () => {
        const db = world([OWN], [{ workspace_id: OWN.id, user_id: USER }])

        await expect(accountDeletionBlockers(db.client, USER)).resolves.toEqual([])
        expect(mocks.subscriptionStillCharges).toHaveBeenCalledExactlyOnceWith('sub_side')
    })

    it('leaves a shared workspace to its other members, whatever its plan', async () => {
        const db = world(
            [SHARED],
            [
                { workspace_id: SHARED.id, user_id: USER },
                { workspace_id: SHARED.id, user_id: TEAMMATE },
            ]
        )

        await expect(accountDeletionBlockers(db.client, USER)).resolves.toEqual([])
        expect(mocks.subscriptionStillCharges).not.toHaveBeenCalled()
    })
})

describe('anonymizeAccount', () => {
    it('refuses without writing anything while a plan still renews', async () => {
        mocks.subscriptionStillCharges.mockResolvedValue(true)
        const db = world([OWN], [{ workspace_id: OWN.id, user_id: USER }])

        await expect(anonymizeAccount(db.client, USER)).resolves.toEqual({ ok: false, blockers: [{ workspaceId: OWN.id, name: OWN.name }] })
        expect(db.chains.filter(chain => writeMethodOf(chain) || chain[0].method === 'rpc')).toEqual([])
        expect(mocks.stopWorkspaceCharges).not.toHaveBeenCalled()
    })

    it('leaves a shared workspace and shuts down an own one', async () => {
        const db = world(
            [SHARED, OWN],
            [
                { workspace_id: SHARED.id, user_id: USER },
                { workspace_id: SHARED.id, user_id: TEAMMATE },
                { workspace_id: OWN.id, user_id: USER },
            ]
        )

        await expect(anonymizeAccount(db.client, USER)).resolves.toEqual({ ok: true })

        const [leave] = db.writes('workspace_members')
        expect(leave.method).toBe('delete')
        expect(leave.filters.map(call => call.args)).toEqual([
            ['workspace_id', SHARED.id],
            ['user_id', USER],
        ])

        expect(mocks.stopWorkspaceCharges).toHaveBeenCalledExactlyOnceWith(db.client, expect.objectContaining({ id: OWN.id, stripeCustomerId: 'cus_side', isSandbox: false }))
        expect(mocks.uninstallWorkspaceApps).toHaveBeenCalledExactlyOnceWith(db.client, OWN.id)
        const [agents] = db.writes('agents')
        expect(agents.payload).toMatchObject({ disabled_reason: ACCOUNT_DELETED_REASON })
        expect(agents.filters.map(call => call.args)).toContainEqual(['workspace_id', OWN.id])
        expect(db.writes('workspaces').map(write => write.filters[0].args)).toEqual([['id', OWN.id]])
    })

    it('leaves the team of an organization first, and never touches a workspace it only ran for a client', async () => {
        const CLIENT: WorkspaceRow = { ...OWN, id: 9, name: 'Client', stripe_customer_id: null, organization_id: 'org-1' }
        const db = world([CLIENT], [{ workspace_id: CLIENT.id, user_id: USER, organization_staff: true }])

        await expect(anonymizeAccount(db.client, USER)).resolves.toEqual({ ok: true })

        expect(mocks.leaveOrganizations).toHaveBeenCalledExactlyOnceWith(USER)
        expect(mocks.stopWorkspaceCharges).not.toHaveBeenCalled()
        expect(db.writes('workspaces')).toEqual([])
    })

    it('leaves the workspace of an organization standing when its last person goes', async () => {
        const CLIENT: WorkspaceRow = { ...OWN, id: 9, name: 'Client', stripe_customer_id: null, organization_id: 'org-1' }
        const db = world([CLIENT], [{ workspace_id: CLIENT.id, user_id: USER }, { workspace_id: CLIENT.id, user_id: 'user-staff', organization_staff: true }])

        await expect(anonymizeAccount(db.client, USER)).resolves.toEqual({ ok: true })

        expect(mocks.stopWorkspaceCharges).not.toHaveBeenCalled()
        expect(db.writes('workspace_members').map(write => write.method)).toEqual(['delete'])
    })

    it('hands a shared workspace to the earliest teammate when its last admin leaves', async () => {
        const db = world(
            [SHARED],
            [
                { workspace_id: SHARED.id, user_id: USER, role: 'admin' },
                { workspace_id: SHARED.id, user_id: TEAMMATE, role: 'member' },
            ]
        )

        await expect(anonymizeAccount(db.client, USER)).resolves.toEqual({ ok: true })

        const [promote, leave] = db.writes('workspace_members')
        expect(promote).toMatchObject({ method: 'update', payload: { role: 'admin' } })
        expect(promote.filters.map(call => call.args)).toEqual([
            ['workspace_id', SHARED.id],
            ['user_id', TEAMMATE],
        ])
        expect(leave.method).toBe('delete')
        expect(mocks.revokeMemberComputers).toHaveBeenCalledWith(SHARED.id, USER)
    })

    it('promotes no one when another admin stays', async () => {
        const db = world(
            [SHARED],
            [
                { workspace_id: SHARED.id, user_id: USER, role: 'admin' },
                { workspace_id: SHARED.id, user_id: TEAMMATE, role: 'admin' },
            ]
        )

        await expect(anonymizeAccount(db.client, USER)).resolves.toEqual({ ok: true })

        expect(db.writes('workspace_members').map(write => write.method)).toEqual(['delete'])
    })

    it('erases what points to the person, then files the auth row under a dead address, last', async () => {
        const db = world([OWN], [{ workspace_id: OWN.id, user_id: USER }])

        await anonymizeAccount(db.client, USER)

        expect(db.writes('user_phones')).toEqual([expect.objectContaining({ method: 'delete' })])
        expect(db.writes('sign_in_codes')).toEqual([expect.objectContaining({ method: 'delete' })])
        expect(db.writes('user_support_tokens')).toEqual([expect.objectContaining({ method: 'delete' })])
        expect(db.writes('users')[0].payload).toMatchObject({ onboarding_answers: null, deleted_at: expect.any(String) })
        expect(mocks.removeAvatars).toHaveBeenCalledWith([`${USER}/a.webp`])

        const last = db.chains.at(-1)!
        expect(last[0]).toEqual({ table: 'rpc:anonymize_auth_user', method: 'rpc', args: ['anonymize_auth_user', { p_user_id: USER, p_email: `${USER}@deleted.rerun.build` }] })
    })

    it('stops before the auth row when billing could not be stopped', async () => {
        mocks.stopWorkspaceCharges.mockRejectedValue(new Error('Stripe is down'))
        const db = world([OWN], [{ workspace_id: OWN.id, user_id: USER }])

        await expect(anonymizeAccount(db.client, USER)).rejects.toThrow('Stripe is down')
        expect(db.chainsOn('rpc:anonymize_auth_user')).toEqual([])
        expect(db.writes('users')).toEqual([])
    })
})
