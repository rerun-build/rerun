import { RERUN_BRAND } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ADMIN, CLIENT, HAVRE, NORDLYS, organizationContext, organizationWorld, OWNER, RIVAL_WORKSPACE, STRANGER, type OrganizationWorld } from '@/ee/test/organization-world'

const mocks = vi.hoisted(() => ({ client: null as unknown, enabled: true, getSessionIdentity: vi.fn(), getBrand: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@/supabase/session/getServerSession', () => ({ getSessionIdentity: mocks.getSessionIdentity }))
vi.mock('@/lib/brand/server', () => ({ getBrand: mocks.getBrand }))
vi.mock('@rerun/cloud/organizations', () => ({ get ORGANIZATIONS_ENABLED() { return mocks.enabled } }))

const { requireActiveOrganization, requireOrganizationContext, requireOrganizationWorkspace } = await import('./organization-context.service')

let world: OrganizationWorld

function open(overrides = {}) {
    world = organizationWorld(overrides)
    mocks.client = world.client
}

const signedIn = (id: string, extra = {}) => mocks.getSessionIdentity.mockResolvedValue({ id, email: 'someone@nordlys.test', is_anonymous: false, user_metadata: {}, app_metadata: {}, ...extra })

beforeEach(() => {
    open()
    mocks.enabled = true
    mocks.getBrand.mockResolvedValue(RERUN_BRAND)
    signedIn(OWNER)
})

describe('requireOrganizationContext', () => {
    it('answers the organization and the role of whoever is in its team', async () => {
        await expect(requireOrganizationContext()).resolves.toMatchObject({ organization: { id: NORDLYS, name: 'Nordlys' }, role: 'owner', userId: OWNER })
        signedIn(ADMIN)
        await expect(requireOrganizationContext()).resolves.toMatchObject({ role: 'admin' })
    })

    it('refuses an admin what takes an owner', async () => {
        signedIn(ADMIN)
        await expect(requireOrganizationContext('owner')).rejects.toMatchObject({ code: 'organizationOwnerOnly' })
    })

    it('refuses a stranger, a visitor, an anonymous session and an install without organizations', async () => {
        signedIn(STRANGER)
        await expect(requireOrganizationContext()).rejects.toMatchObject({ code: 'notAuthorized' })
        mocks.getSessionIdentity.mockResolvedValue(null)
        await expect(requireOrganizationContext()).rejects.toMatchObject({ code: 'notAuthenticated' })
        signedIn(OWNER, { is_anonymous: true })
        await expect(requireOrganizationContext()).rejects.toMatchObject({ code: 'notAuthenticated' })
        signedIn(OWNER)
        mocks.enabled = false
        await expect(requireOrganizationContext()).rejects.toMatchObject({ code: 'notAuthorized' })
    })

    it('is the earliest of someone in two teams, and the one of the host they visit', async () => {
        world.rows('organization_members').push({ organization_id: HAVRE, user_id: OWNER, role: 'admin', created_at: '2026-10-01T00:00:00.000Z' })
        await expect(requireOrganizationContext()).resolves.toMatchObject({ organization: { id: HAVRE }, role: 'admin' })

        mocks.getBrand.mockResolvedValue({ ...RERUN_BRAND, organizationId: NORDLYS })
        await expect(requireOrganizationContext()).resolves.toMatchObject({ organization: { id: NORDLYS }, role: 'owner' })
    })

    it('refuses the team of another organization on the host of one', async () => {
        mocks.getBrand.mockResolvedValue({ ...RERUN_BRAND, organizationId: HAVRE })
        await expect(requireOrganizationContext()).rejects.toMatchObject({ code: 'notAuthorized' })
    })

    it('reads a role it does not know as the lower one', async () => {
        world.rows('organization_members')[0].role = 'root'
        await expect(requireOrganizationContext('owner')).rejects.toMatchObject({ code: 'organizationOwnerOnly' })
    })

    it('throws rather than refusing when the read failed', async () => {
        world = organizationWorld({}, table => (table === 'organization_members' ? { error: { message: 'down' } } : undefined))
        mocks.client = world.client
        await expect(requireOrganizationContext()).rejects.toThrow('down')
    })
})

describe('a suspended organization', () => {
    beforeEach(() => {
        world.rows('organizations')[0].status = 'suspended'
    })

    it('still reads', async () => {
        await expect(requireOrganizationContext()).resolves.toMatchObject({ organization: { status: 'suspended' } })
    })

    it('changes nothing', async () => {
        await expect(requireActiveOrganization()).rejects.toMatchObject({ code: 'organizationSuspended' })
        await expect(requireActiveOrganization('owner')).rejects.toMatchObject({ code: 'organizationSuspended' })
    })
})

describe('requireOrganizationWorkspace', () => {
    it('answers its own', async () => {
        await expect(requireOrganizationWorkspace(organizationContext(world), CLIENT)).resolves.toMatchObject({ id: CLIENT, name: 'Acme' })
    })

    it('answers another organization’s, and one of nobody, like one that does not exist', async () => {
        const ctx = organizationContext(world)
        for (const id of [RIVAL_WORKSPACE, 10, 424242]) await expect(requireOrganizationWorkspace(ctx, id)).rejects.toMatchObject({ code: 'workspaceNotFound' })
    })
})
