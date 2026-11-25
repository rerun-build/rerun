import type { User } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ADMIN, CLIENT, EMAILS, HAVRE, memberRow, NORDLYS, organizationContext, organizationWorld, OWNER, RIVAL, STRANGER, type OrganizationWorld } from '@/ee/test/organization-world'

const mocks = vi.hoisted(() => ({ client: null as unknown, delivery: true, sendWorkspaceInviteEmail: vi.fn(async () => ({ ok: true, id: null })) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@/supabase/session/getServerSession', () => ({ getSessionIdentity: vi.fn() }))
vi.mock('@rerun/cloud/organizations', () => ({ ORGANIZATIONS_ENABLED: true }))
vi.mock('@rerun/cloud/illustrations', () => ({ ILLUSTRATION_ENTRIES: [] }))
vi.mock('@rerun/cloud/email', () => ({ get EMAIL_DELIVERY() { return mocks.delivery }, sendWorkspaceInviteEmail: mocks.sendWorkspaceInviteEmail, BANNER_WARM_BACKGROUND_MS: 0, emailBoardBanner: vi.fn() }))
vi.mock('next/server', () => ({ after: (task: () => unknown) => void task() }))
vi.mock('@/app/api/_services/remote-computers.service', () => ({ revokeMemberComputers: vi.fn(async () => {}) }))

const { acceptTeamInvitation, inviteTeamMember, listOrganizationTeam, removeTeamMember, revokeTeamInvitation, setTeamMemberRole, viewTeamInvitation } = await import('./organization-team.service')

let world: OrganizationWorld
const owner = () => organizationContext(world)
const roleOf = (userId: string) => world.rows('organization_members').find(row => row.user_id === userId && row.organization_id === NORDLYS)?.role
const invitations = () => world.rows('organization_invitations')
const account = (id: string, email = EMAILS[id]) => ({ id, email, identities: [] }) as unknown as User
const HOUR = 3_600_000

beforeEach(() => {
    vi.clearAllMocks()
    mocks.delivery = true
    world = organizationWorld()
    mocks.client = world.client
})

describe('inviting', () => {
    it('writes one pending invitation and emails it in the brand’s name', async () => {
        await expect(inviteTeamMember(owner(), ' New@Nordlys.test ', 'admin')).resolves.toEqual({})
        expect(invitations()).toEqual([expect.objectContaining({ organization_id: NORDLYS, email: 'new@nordlys.test', role: 'admin', status: 'pending', invited_by: OWNER })])
        expect(mocks.sendWorkspaceInviteEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: 'new@nordlys.test', workspaceName: 'Nordlys', brand: expect.objectContaining({ organizationId: NORDLYS }), inviteUrl: expect.stringContaining(`/organization/invite/${invitations()[0].token}`) }))
    })

    it('sends the pending one again with its new role and a full delay', async () => {
        await inviteTeamMember(owner(), 'new@nordlys.test', 'admin')
        const [before] = invitations().map(row => ({ ...row }))
        invitations()[0].expires_at = new Date(Date.now() - HOUR).toISOString()
        await inviteTeamMember(owner(), 'new@nordlys.test', 'owner')
        expect(invitations()).toHaveLength(1)
        expect(invitations()[0]).toMatchObject({ role: 'owner', token: before.token })
        expect(Date.parse(invitations()[0].expires_at as string)).toBeGreaterThan(Date.now() + HOUR)
    })

    it('hands the link back where no email leaves', async () => {
        mocks.delivery = false
        await expect(inviteTeamMember(owner(), 'new@nordlys.test', 'admin')).resolves.toEqual({ inviteUrl: expect.stringMatching(/\/organization\/invite\//) })
    })

    it('refuses an address that is not one, and someone already there', async () => {
        await expect(inviteTeamMember(owner(), 'nope', 'admin')).rejects.toMatchObject({ code: 'invalidEmailShort' })
        await expect(inviteTeamMember(owner(), 'ADMIN@nordlys.test', 'owner')).rejects.toMatchObject({ code: 'alreadyTeamMember' })
        expect(invitations()).toEqual([])
    })

    it('does not renew the invitation another organization sent to the same person', async () => {
        invitations().push({ id: 'i-rival', organization_id: HAVRE, email: 'new@nordlys.test', role: 'owner', token: 'rival-token', status: 'pending', expires_at: new Date(Date.now() + HOUR).toISOString() })
        await inviteTeamMember(owner(), 'new@nordlys.test', 'admin')
        expect(invitations()[0]).toMatchObject({ role: 'owner', token: 'rival-token' })
        expect(invitations()).toHaveLength(2)
    })
})

describe('an invitation', () => {
    beforeEach(() => {
        invitations().push({ id: 'i-1', organization_id: NORDLYS, email: EMAILS[STRANGER], role: 'admin', token: 'tok', status: 'pending', expires_at: new Date(Date.now() + HOUR).toISOString(), created_at: '2026-11-20T00:00:00Z' })
    })

    it('is shown to whoever holds the link, with nothing of the team', async () => {
        await expect(viewTeamInvitation('tok')).resolves.toEqual({ status: 'ok', email: EMAILS[STRANGER], organizationName: 'Nordlys' })
        await expect(viewTeamInvitation('other')).resolves.toEqual({ status: 'not_found' })
    })

    it('is accepted by the person it was sent to, with its role', async () => {
        await expect(acceptTeamInvitation(account(STRANGER), 'tok')).resolves.toEqual({ organizationId: NORDLYS })
        expect(roleOf(STRANGER)).toBe('admin')
        expect(invitations()[0]).toMatchObject({ status: 'accepted', accepted_at: expect.any(String) })
    })

    it('lands once from two tabs, and again for whoever is in', async () => {
        const results = await Promise.allSettled([acceptTeamInvitation(account(STRANGER), 'tok'), acceptTeamInvitation(account(STRANGER), 'tok')])
        expect(results.some(result => result.status === 'fulfilled')).toBe(true)
        expect(world.rows('organization_members').filter(row => row.user_id === STRANGER)).toHaveLength(1)
        await expect(acceptTeamInvitation(account(STRANGER), 'tok')).resolves.toEqual({ organizationId: NORDLYS })
    })

    it('does not let back in someone taken off the team since', async () => {
        await acceptTeamInvitation(account(STRANGER), 'tok')
        await removeTeamMember(owner(), STRANGER)
        await expect(acceptTeamInvitation(account(STRANGER), 'tok')).rejects.toMatchObject({ code: 'invitationInvalid' })
        expect(roleOf(STRANGER)).toBeUndefined()
    })

    it('is refused to anyone else, expired, revoked, unknown, or of a suspended organization', async () => {
        await expect(acceptTeamInvitation(account(RIVAL), 'tok')).rejects.toMatchObject({ code: 'invitationForEmail' })
        await expect(acceptTeamInvitation(account(STRANGER), 'nope')).rejects.toMatchObject({ code: 'invitationNotFound' })
        world.rows('organizations')[0].status = 'suspended'
        await expect(acceptTeamInvitation(account(STRANGER), 'tok')).rejects.toMatchObject({ code: 'organizationSuspended' })
        world.rows('organizations')[0].status = 'active'
        invitations()[0].expires_at = new Date(Date.now() - 1000).toISOString()
        await expect(acceptTeamInvitation(account(STRANGER), 'tok')).rejects.toMatchObject({ code: 'invitationExpired' })
        invitations()[0].status = 'revoked'
        await expect(acceptTeamInvitation(account(STRANGER), 'tok')).rejects.toMatchObject({ code: 'invitationInvalid' })
        expect(roleOf(STRANGER)).toBeUndefined()
    })

    it('is pending again when the membership could not be written', async () => {
        world = organizationWorld({ organization_invitations: world.rows('organization_invitations') }, (table, calls) => (table === 'organization_members' && calls.some(call => call.method === 'upsert') ? { error: { message: 'down' } } : undefined))
        mocks.client = world.client
        await expect(acceptTeamInvitation(account(STRANGER), 'tok')).rejects.toThrow('down')
        expect(invitations()[0]).toMatchObject({ status: 'pending', accepted_at: null })
    })

    it('is revoked by its own organization only, once', async () => {
        const rival = organizationContext(world, { organizationId: HAVRE, userId: RIVAL })
        await expect(revokeTeamInvitation(rival, 'i-1')).rejects.toMatchObject({ code: 'invitationNotFound' })
        await revokeTeamInvitation(owner(), 'i-1')
        await expect(revokeTeamInvitation(owner(), 'i-1')).rejects.toMatchObject({ code: 'invitationNotFound' })
        expect(invitations()[0].status).toBe('revoked')
    })

    it('shows in the team list, next to the members, without its token', async () => {
        const team = await listOrganizationTeam(owner())
        expect(team).toMatchObject({ currentUserId: OWNER, currentRole: 'owner', members: [{ userId: OWNER, role: 'owner', email: EMAILS[OWNER] }, { userId: ADMIN, role: 'admin' }], invitations: [{ id: 'i-1', email: EMAILS[STRANGER], role: 'admin' }] })
        expect(JSON.stringify(team)).not.toContain('tok"')
    })
})

describe('the last owner', () => {
    it('cannot step down, be demoted nor be removed', async () => {
        await expect(setTeamMemberRole(owner(), OWNER, 'admin')).rejects.toMatchObject({ code: 'organizationNeedsOwner' })
        await expect(removeTeamMember(owner(), OWNER)).rejects.toMatchObject({ code: 'organizationNeedsOwner' })
        expect(roleOf(OWNER)).toBe('owner')
    })

    it('hands over, then goes', async () => {
        await setTeamMemberRole(owner(), ADMIN, 'owner')
        await removeTeamMember(owner(), OWNER)
        expect(roleOf(OWNER)).toBeUndefined()
        expect(roleOf(ADMIN)).toBe('owner')
    })

    it('is still there after two owners stepped down at once, from two tabs', async () => {
        await setTeamMemberRole(owner(), ADMIN, 'owner')
        await Promise.allSettled([setTeamMemberRole(owner(), OWNER, 'admin'), setTeamMemberRole(owner(), ADMIN, 'admin')])
        expect([roleOf(OWNER), roleOf(ADMIN)]).toContain('owner')
    })

    it('is still there after two owners removed each other at once', async () => {
        await setTeamMemberRole(owner(), ADMIN, 'owner')
        await Promise.allSettled([removeTeamMember(owner(), ADMIN), removeTeamMember(organizationContext(world, { userId: ADMIN }), OWNER)])
        expect(world.rows('organization_members').filter(row => row.organization_id === NORDLYS && row.role === 'owner').length).toBeGreaterThan(0)
    })

    it('does not count the owners of another organization', async () => {
        world.rows('organization_members').push({ organization_id: HAVRE, user_id: STRANGER, role: 'owner', created_at: '2026-11-05T00:00:00Z' })
        await expect(setTeamMemberRole(owner(), OWNER, 'admin')).rejects.toMatchObject({ code: 'organizationNeedsOwner' })
    })
})

describe('taking someone off the team', () => {
    it('takes them out of the clients’ workspaces too', async () => {
        world.rows('workspace_members').push(memberRow(ADMIN, CLIENT, { organization_staff: true }))
        await removeTeamMember(owner(), ADMIN)
        expect(roleOf(ADMIN)).toBeUndefined()
        expect(world.rows('workspace_members').some(row => row.user_id === ADMIN && row.organization_staff)).toBe(false)
    })

    it('refuses someone of another team', async () => {
        await expect(removeTeamMember(owner(), RIVAL)).rejects.toMatchObject({ code: 'teamMemberNotFound' })
        await expect(setTeamMemberRole(owner(), RIVAL, 'admin')).rejects.toMatchObject({ code: 'teamMemberNotFound' })
        expect(world.rows('organization_members').find(row => row.user_id === RIVAL)).toMatchObject({ role: 'owner', organization_id: HAVRE })
    })
})
