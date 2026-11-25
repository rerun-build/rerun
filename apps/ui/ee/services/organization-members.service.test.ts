import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CLIENT, organizationContext, organizationWorld, RIVAL_WORKSPACE, type OrganizationWorld } from '@/ee/test/organization-world'

const mocks = vi.hoisted(() => ({ client: null as unknown, sendWorkspaceInviteEmail: vi.fn(async () => ({ ok: true, id: null })) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@/supabase/session/getServerSession', () => ({ getSessionIdentity: vi.fn() }))
vi.mock('@rerun/cloud/organizations', () => ({ ORGANIZATIONS_ENABLED: true }))
vi.mock('@rerun/cloud/organizations.server', () => ({ organizationBrandOfWorkspace: async () => null }))
vi.mock('@rerun/cloud/email', () => ({ EMAIL_DELIVERY: true, sendWorkspaceInviteEmail: mocks.sendWorkspaceInviteEmail, BANNER_WARM_BACKGROUND_MS: 0, emailBoardBanner: vi.fn(async () => 'https://app.test/og') }))
vi.mock('next/server', () => ({ after: (task: () => unknown) => void task() }))
vi.mock('@/app/api/_services/remote-computers.service', () => ({ revokeMemberComputers: vi.fn(async () => {}) }))

const { readOrganizationWorkspaceInvitationUrl, resendOrganizationWorkspaceInvitation } = await import('./organization-members.service')

const EXPIRED = '2026-01-01T00:00:00.000Z'
const invitationRow = (overrides = {}) => ({ id: 'i1', workspace_id: CLIENT, email: 'lea@acme.test', token: 'tok-1', role: 'admin', box_scope: 'assigned', status: 'pending', expires_at: EXPIRED, created_at: '1', ...overrides })

let world: OrganizationWorld
const ctx = () => organizationContext(world)
const invitation = (id: string) => world.rows('workspace_invitations').find(row => row.id === id)!

beforeEach(() => {
    vi.clearAllMocks()
    world = organizationWorld({ workspace_invitations: [invitationRow(), invitationRow({ id: 'i2', status: 'revoked', token: 'tok-2' }), invitationRow({ id: 'i3', workspace_id: RIVAL_WORKSPACE, token: 'tok-3' })] })
    mocks.client = world.client
})

describe('an invitation sent again', () => {
    it('keeps its link, its role and its Boxes, and works for seven more days', async () => {
        await expect(resendOrganizationWorkspaceInvitation(ctx(), CLIENT, 'i1')).resolves.toEqual({ ok: true })
        expect(invitation('i1')).toMatchObject({ token: 'tok-1', role: 'admin', box_scope: 'assigned', status: 'pending' })
        expect(new Date(invitation('i1').expires_at as string).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3_600_000)
        await vi.waitFor(() => expect(mocks.sendWorkspaceInviteEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: 'lea@acme.test', inviteUrl: expect.stringContaining('/invite/tok-1'), invitedByEmail: undefined })))
    })

    it.each([
        ['one that was revoked', CLIENT, 'i2', 'invitationNotFound'],
        ['one that does not exist', CLIENT, 'nope', 'invitationNotFound'],
        ['one of another workspace', CLIENT, 'i3', 'invitationNotFound'],
        ['one of another organization', RIVAL_WORKSPACE, 'i3', 'workspaceNotFound'],
    ])('is never %s', async (_, workspaceId, id, code) => {
        await expect(resendOrganizationWorkspaceInvitation(ctx(), workspaceId, id)).rejects.toMatchObject({ code })
        await expect(readOrganizationWorkspaceInvitationUrl(ctx(), workspaceId, id)).rejects.toMatchObject({ code })
        expect(world.rows('workspace_invitations').every(row => row.expires_at === EXPIRED)).toBe(true)
        expect(mocks.sendWorkspaceInviteEmail).not.toHaveBeenCalled()
    })
})

describe('its link', () => {
    it('is the one of its email', async () => {
        await expect(readOrganizationWorkspaceInvitationUrl(ctx(), CLIENT, 'i1')).resolves.toMatch(/\/invite\/tok-1$/)
    })
})
