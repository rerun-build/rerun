import type { User } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AGENCY_HOME, CLIENT, CLIENT_ADMIN, HAVRE, memberRow, NORDLYS, organizationWorld, OWNER, RIVAL_WORKSPACE, STRANGER, workspaceRow, type OrganizationWorld } from '@/ee/test/organization-world'
import type { MemoryTables } from '@/ee/test/memory-database'
import { writeMethodOf, type SupabaseCall, type SupabaseResult } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({ client: null as unknown, topup: vi.fn(async () => {}) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@rerun/cloud/organizations', () => ({ ORGANIZATIONS_ENABLED: true }))
vi.mock('@rerun/cloud/organizations.server', () => ({ organizationBrandOfWorkspace: async () => null }))
vi.mock('@rerun/cloud/billing.server', () => ({ grantRerunTopup: mocks.topup }))
vi.mock('@rerun/cloud/illustrations', () => ({ ILLUSTRATION_ENTRIES: [] }))
vi.mock('@rerun/cloud/email', () => ({ EMAIL_DELIVERY: false, sendWorkspaceInviteEmail: vi.fn() }))
vi.mock('@/ee/services/referral-attach.service', () => ({ attachReferral: vi.fn() }))
vi.mock('@/app/api/_services/remote-computers.service', () => ({ revokeMemberComputers: vi.fn() }))
vi.mock('next/server', () => ({ after: () => {} }))

const { joinOrganization } = await import('./organization-join.service')

const NEWCOMER = '00000000-0000-4000-8000-0000000b0001'
const EMAIL = 'new@acme.test'
const SECOND = 21

const soon = () => new Date(Date.now() + 3_600_000).toISOString()
const account = (id = NEWCOMER, email = EMAIL, identities: object[] = []) => ({ id, email, identities }) as unknown as User
const invitation = (overrides: object = {}) => ({ id: 'invite-1', workspace_id: CLIENT, email: EMAIL, status: 'pending', role: 'member', box_scope: 'assigned', token: 'tok', expires_at: soon(), created_at: '2026-11-01', ...overrides })
const teamInvitation = (overrides: object = {}) => ({ id: 'team-1', organization_id: NORDLYS, email: EMAIL, status: 'pending', role: 'admin', token: 'team-tok', expires_at: soon(), created_at: '2026-11-01', accepted_at: null, ...overrides })

let world: OrganizationWorld

function build(overrides: MemoryTables = {}, before?: (table: string, calls: readonly SupabaseCall[]) => SupabaseResult | undefined | void) {
    // `users.id` is the key two first requests race on, which the world has no index for.
    world = organizationWorld(overrides, (table, calls) => {
        const planned = before?.(table, calls)
        if (planned) return planned
        if (table === 'users' && writeMethodOf(calls) === 'insert') {
            const { id } = calls.find(call => call.method === 'insert')!.args[0] as { id: string }
            if (world.rows('users').some(user => user.id === id)) return { error: { code: '23505', message: 'users_pkey' } }
        }
    })
    mocks.client = world.client
}

const join = (user = account(), organizationId = NORDLYS) => joinOrganization(user, organizationId, { locale: 'fr' })
const usersRow = (id = NEWCOMER) => world.rows('users').filter(user => user.id === id)
const memberships = (id = NEWCOMER) => world.rows('workspace_members').filter(member => member.user_id === id)

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    build()
})

describe('an account born on an organization’s address', () => {
    it('opens on the workspace it was invited to, with nothing of its own', async () => {
        build({ workspace_invitations: [invitation()] })
        const workspaces = world.rows('workspaces').length

        await expect(join()).resolves.toEqual({ signedUp: true })

        expect(usersRow()).toEqual([expect.objectContaining({ workspace_id: CLIENT, signed_up_at: expect.any(String) })])
        expect(memberships()).toEqual([expect.objectContaining({ workspace_id: CLIENT, role: 'member', box_scope: 'assigned', organization_staff: false })])
        expect(world.rows('workspace_invitations')[0]).toMatchObject({ status: 'accepted', accepted_at: expect.any(String) })
        expect(world.rows('workspaces')).toHaveLength(workspaces)
        expect(mocks.topup).not.toHaveBeenCalled()
        expect(world.rows('user_phones')).toEqual([])
    })

    it('is an admin when it was invited as one', async () => {
        build({ workspace_invitations: [invitation({ role: 'admin', box_scope: 'all' })] })
        await join()
        expect(memberships()[0]).toMatchObject({ role: 'admin' })
    })

    it('joins every workspace of the organization it was invited to, and none of another', async () => {
        build({ workspace_invitations: [invitation(), invitation({ id: 'invite-2', workspace_id: SECOND, created_at: '2026-11-02' }), invitation({ id: 'invite-3', workspace_id: RIVAL_WORKSPACE })] })
        world.rows('workspaces').push(workspaceRow(SECOND))
        await join()
        expect(memberships().map(member => member.workspace_id).sort()).toEqual([CLIENT, SECOND])
        expect(world.rows('workspace_invitations').find(row => row.id === 'invite-3')).toMatchObject({ status: 'pending' })
    })

    it('answers to a verified address linked to it', async () => {
        build({ workspace_invitations: [invitation()] })
        const linked = (verified: boolean) => [{ identity_data: { email: EMAIL, email_verified: verified } }]
        await expect(join(account(NEWCOMER, 'other@acme.test', linked(false)))).resolves.toBeNull()
        await expect(join(account(NEWCOMER, 'other@acme.test', linked(true)))).resolves.toEqual({ signedUp: true })
    })

    it('is not born at all without an invitation here', async () => {
        build({ workspace_invitations: [invitation({ workspace_id: RIVAL_WORKSPACE })] })
        await expect(join()).resolves.toBeNull()
        expect(usersRow()).toEqual([])
        expect(memberships()).toEqual([])
    })

    it.each([
        ['expired', { expires_at: new Date(Date.now() - 1000).toISOString() }],
        ['revoked', { status: 'revoked' }],
        ['already used', { status: 'accepted' }],
    ])('does not join by an invitation %s', async (_case, overrides) => {
        build({ workspace_invitations: [invitation(overrides)] })
        await expect(join()).resolves.toBeNull()
        expect(usersRow()).toEqual([])
    })

    it('gives the invitation back when its row cannot be written, and the next request tries again', async () => {
        let failing = true
        build({ workspace_invitations: [invitation()] }, (table, calls) => (failing && table === 'users' && writeMethodOf(calls) === 'insert' ? { error: { code: 'XX000', message: 'down' } } : undefined))
        await expect(join()).resolves.toBeNull()
        expect(world.rows('workspace_invitations')[0]).toMatchObject({ status: 'pending', accepted_at: null })
        failing = false
        await expect(join()).resolves.toEqual({ signedUp: true })
    })

    it('never points at a workspace whose invitation was taken back meanwhile', async () => {
        build({ workspace_invitations: [invitation()] }, (table, calls) => (table === 'workspace_invitations' && writeMethodOf(calls) === 'update' ? { data: null } : undefined))
        await expect(join()).resolves.toBeNull()
        expect(usersRow()).toEqual([])
    })
})

describe('the requests of a first page load', () => {
    it('arrive together and make one account, one membership, one acceptance', async () => {
        build({ workspace_invitations: [invitation()] })
        const answers = await Promise.all([join(), join(), join(), join()])
        expect(answers).toEqual(Array(4).fill({ signedUp: true }))
        expect(usersRow()).toHaveLength(1)
        expect(memberships()).toHaveLength(1)
        expect(world.writes('workspace_invitations').filter(write => (write.payload as { status: string }).status === 'pending')).toEqual([])
    })

    it('may be repeated forever after', async () => {
        build({ workspace_invitations: [invitation()] })
        await join()
        const before = JSON.stringify(world.tables)
        await expect(join()).resolves.toEqual({ signedUp: true })
        expect(JSON.stringify(world.tables)).toBe(before)
    })
})

describe('an account that exists already', () => {
    it('joins what it was invited to and keeps its own workspace', async () => {
        build({ workspace_invitations: [invitation({ email: 'stranger@else.test' })] })
        await expect(join(account(STRANGER, 'stranger@else.test'))).resolves.toEqual({ signedUp: true })
        expect(usersRow(STRANGER)).toEqual([expect.objectContaining({ workspace_id: 99 })])
        expect(memberships(STRANGER).map(member => member.workspace_id)).toEqual([99, CLIENT])
    })

    it('has no place without an invitation or a membership here', async () => {
        await expect(join(account(STRANGER, 'stranger@else.test'))).resolves.toBeNull()
        await expect(join(account(CLIENT_ADMIN, 'client@acme.test'), HAVRE)).resolves.toBeNull()
    })

    it('has its place as a member, or in the team', async () => {
        await expect(join(account(CLIENT_ADMIN, 'client@acme.test'))).resolves.toEqual({ signedUp: true })
        await expect(join(account(OWNER, 'owner@nordlys.test'))).resolves.toEqual({ signedUp: true })
    })

    it('is stamped signed up, with no credit, when it never was', async () => {
        world.rows('users').find(user => user.id === CLIENT_ADMIN)!.signed_up_at = null
        await join(account(CLIENT_ADMIN, 'client@acme.test'))
        expect(usersRow(CLIENT_ADMIN)[0].signed_up_at).toEqual(expect.any(String))
        expect(mocks.topup).not.toHaveBeenCalled()
    })

    it('of the team, invited by name, becomes an ordinary member', async () => {
        build({ workspace_invitations: [invitation({ email: 'owner@nordlys.test' })], workspace_members: [memberRow(OWNER, AGENCY_HOME), memberRow(OWNER, CLIENT, { organization_staff: true })] })
        await join(account(OWNER, 'owner@nordlys.test'))
        expect(memberships(OWNER).find(member => member.workspace_id === CLIENT)).toMatchObject({ organization_staff: false, role: 'member' })
    })

    it('that cannot be read is left for the next request', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        build({ workspace_invitations: [invitation()] }, table => (table === 'users' ? { data: null, error: { message: 'down' } } : undefined))
        await expect(join()).resolves.toBeNull()
        expect(world.rows('workspace_invitations')[0]).toMatchObject({ status: 'pending' })
    })
})

describe('someone invited to the team', () => {
    it('gets an account with a workspace of its own, no credit, no email of Rerun’s, and joins the team', async () => {
        build({ organization_invitations: [teamInvitation()] })
        await expect(join()).resolves.toEqual({ signedUp: true })

        const [user] = usersRow()
        expect(world.rows('workspaces').find(workspace => workspace.id === user.workspace_id)).toMatchObject({ organization_id: null, rerun_budget_micros: 0 })
        expect(user.email_notification_prefs).toMatchObject({ categories: { product: false, billing: false } })
        expect(mocks.topup).not.toHaveBeenCalled()
        expect(world.rows('user_phones')).toEqual([])
        expect(world.rows('organization_members')).toContainEqual(expect.objectContaining({ organization_id: NORDLYS, user_id: NEWCOMER, role: 'admin' }))
        expect(memberships().map(member => member.workspace_id)).toEqual([user.workspace_id])
    })

    it('opens on the client’s workspace when they were invited there too', async () => {
        build({ workspace_invitations: [invitation()], organization_invitations: [teamInvitation()] })
        const workspaces = world.rows('workspaces').length
        await join()
        expect(usersRow()[0].workspace_id).toBe(CLIENT)
        expect(world.rows('workspaces')).toHaveLength(workspaces)
        expect(world.rows('organization_members')).toContainEqual(expect.objectContaining({ user_id: NEWCOMER }))
    })

    it('of another organization is not let in here', async () => {
        build({ organization_invitations: [teamInvitation({ organization_id: HAVRE })] })
        await expect(join()).resolves.toBeNull()
        expect(usersRow()).toEqual([])
        expect(world.rows('organization_members').some(member => member.user_id === NEWCOMER)).toBe(false)
    })

    it('makes one account of the requests that arrive together', async () => {
        build({ organization_invitations: [teamInvitation()] })
        await Promise.all([join(), join(), join()])
        expect(usersRow()).toHaveLength(1)
        expect(world.rows('organization_members').filter(member => member.user_id === NEWCOMER)).toHaveLength(1)
        // The workspaces the others drew for it went back out.
        expect(world.rows('workspaces').filter(workspace => workspace.organization_id === null && workspace.id !== AGENCY_HOME)).toHaveLength(1)
    })
})
