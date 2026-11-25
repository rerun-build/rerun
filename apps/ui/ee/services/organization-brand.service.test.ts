import { RERUN_BRAND } from '@rerun/contracts'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AGENCY_HOME, CLIENT, CLIENT_ADMIN, HAVRE, memberRow, NORDLYS, organizationRow, organizationWorld, OWNER, RIVAL_WORKSPACE, STRANGER } from '@/ee/test/organization-world'

const mocks = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@/lib/app-url', () => ({ APP_URL: 'https://app.rerun.build' }))
vi.mock('@rerun/cloud/organizations', () => ({ ORGANIZATIONS_ENABLED: true }))
vi.mock('@rerun/cloud/organizations.server', async () => import('./organization-brand.service'))

const { forgetOrganizationBrands, organizationBrand, organizationBrandOfAccount, organizationDefaultUrlOfWorkspace, organizationOfHost } = await import('./organization-brand.service')
const { authEmailBrand, workspaceAppUrl, workspaceBrand, workspaceStableUrl } = await import('@/lib/brand/workspace')

vi.useFakeTimers({ toFake: ['Date'] })

// Past what is kept in memory, so that each test reads its own rows.
beforeEach(() => {
    vi.setSystemTime(Date.now() + 60_000)
    mocks.client = organizationWorld().client
})

afterAll(() => void vi.useRealTimers())
afterEach(() => vi.unstubAllEnvs())

describe('the brand of an organization', () => {
    it('is what its team set', async () => {
        expect(organizationBrand(organizationRow({ docs_url: 'https://docs.nordlys.test', terms_url: null }) as never)).toEqual({
            organizationId: NORDLYS,
            name: 'Nordlys',
            iconUrl: 'https://cdn.test/nordlys.webp',
            color: '#0a7d5a',
            supportEmail: 'help@nordlys.test',
            appUrl: null,
            links: { docs: 'https://docs.nordlys.test', terms: null, privacy: null },
        })
    })

    it('is the one of its workspaces, each organization’s its own, and Rerun’s everywhere else', async () => {
        expect((await workspaceBrand(CLIENT)).name).toBe('Nordlys')
        expect((await workspaceBrand(RIVAL_WORKSPACE)).name).toBe('Havre')
        expect(await workspaceBrand(AGENCY_HOME)).toBe(RERUN_BRAND)
        expect(await workspaceBrand(424242)).toBe(RERUN_BRAND)
    })

    it('is read once in a while, whoever asks', async () => {
        const world = organizationWorld()
        mocks.client = world.client
        await workspaceBrand(CLIENT)
        await workspaceBrand(CLIENT)
        expect(world.chains).toHaveLength(2)
    })

    it('throws when it cannot be read, rather than speaking in Rerun’s name, and is asked for again', async () => {
        mocks.client = organizationWorld({}, () => ({ error: { message: 'down' } })).client
        await expect(workspaceBrand(CLIENT)).rejects.toThrow('down')
        mocks.client = organizationWorld().client
        expect((await workspaceBrand(CLIENT)).name).toBe('Nordlys')
    })
})

const domain = (overrides: object = {}) => ({ id: 'd1', organization_id: NORDLYS, hostname: 'app.nordlys.test', status: 'active', failing_since: null, created_at: '2026-11-02', ...overrides })

describe('the address of an organization', () => {
    beforeEach(() => {
        vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', 'rerun.work')
        forgetOrganizationBrands()
    })

    it('is its default one, then the first domain of its own being served', async () => {
        expect(await workspaceAppUrl(CLIENT)).toBe('https://nordlys.rerun.work')
        mocks.client = organizationWorld({ organization_domains: [domain({ hostname: 'later.nordlys.test', created_at: '2026-11-09', id: 'd2' }), domain()] }).client
        forgetOrganizationBrands()
        expect(await workspaceAppUrl(CLIENT)).toBe('https://app.nordlys.test')
    })

    it.each(['pending', 'error'])('is never a domain that is %s', async status => {
        mocks.client = organizationWorld({ organization_domains: [domain({ status })] }).client
        expect(await workspaceAppUrl(CLIENT)).toBe('https://nordlys.rerun.work')
    })

    it('falls back on its default one while its domain no longer points here, though it is still served', async () => {
        mocks.client = organizationWorld({ organization_domains: [domain({ failing_since: '2026-11-20T10:00:00Z' })] }).client
        expect(await workspaceAppUrl(CLIENT)).toBe('https://nordlys.rerun.work')
        expect(await organizationOfHost({ kind: 'domain', hostname: 'app.nordlys.test' })).toMatchObject({ organizationId: NORDLYS })
    })

    it('is Rerun’s own for a workspace no organization runs', async () => {
        expect((await workspaceBrand(AGENCY_HOME)).appUrl).toBeNull()
        expect(await workspaceStableUrl(AGENCY_HOME)).toBeNull()
    })

    it('outlives its domain where third parties keep calling', async () => {
        mocks.client = organizationWorld({ organization_domains: [domain()] }).client
        expect(await workspaceStableUrl(CLIENT)).toBe('https://nordlys.rerun.work')
        expect(await organizationDefaultUrlOfWorkspace(RIVAL_WORKSPACE)).toBe('https://havre.rerun.work')
    })

    it('is nowhere while organizations have no address, and nothing is read for it', async () => {
        vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', '')
        const world = organizationWorld({ organization_domains: [domain()] })
        mocks.client = world.client
        expect((await workspaceBrand(CLIENT)).appUrl).toBeNull()
        expect(await workspaceStableUrl(CLIENT)).toBeNull()
        expect(world.chainsOn('organization_domains')).toHaveLength(0)
    })
})

describe('the organization of a host', () => {
    beforeEach(() => {
        vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', 'rerun.work')
        forgetOrganizationBrands()
    })

    it('is found by its slug and by the domain it proved', async () => {
        mocks.client = organizationWorld({ organization_domains: [domain()] }).client
        await expect(organizationOfHost({ kind: 'organization', slug: 'nordlys' })).resolves.toMatchObject({ organizationId: NORDLYS, suspended: false, brand: { name: 'Nordlys' } })
        await expect(organizationOfHost({ kind: 'domain', hostname: 'app.nordlys.test' })).resolves.toMatchObject({ organizationId: NORDLYS })
    })

    it('is nobody for a slug never taken and for a domain not proven', async () => {
        mocks.client = organizationWorld({ organization_domains: [domain({ status: 'pending' })] }).client
        await expect(organizationOfHost({ kind: 'organization', slug: 'nobody' })).resolves.toBeNull()
        await expect(organizationOfHost({ kind: 'domain', hostname: 'app.nordlys.test' })).resolves.toBeNull()
    })

    it('says when it is suspended', async () => {
        const world = organizationWorld()
        world.rows('organizations')[0].status = 'suspended'
        mocks.client = world.client
        await expect(organizationOfHost({ kind: 'organization', slug: 'nordlys' })).resolves.toMatchObject({ suspended: true })
    })

    it('is kept for half a minute, nobody included, until it is forgotten', async () => {
        const world = organizationWorld()
        mocks.client = world.client
        for (let i = 0; i < 3; i++) {
            await organizationOfHost({ kind: 'organization', slug: 'nordlys' })
            await organizationOfHost({ kind: 'organization', slug: 'nobody' })
        }
        expect(world.chainsOn('organizations')).toHaveLength(2)
        forgetOrganizationBrands()
        await organizationOfHost({ kind: 'organization', slug: 'nordlys' })
        expect(world.chainsOn('organizations')).toHaveLength(3)
        vi.setSystemTime(Date.now() + 31_000)
        await organizationOfHost({ kind: 'organization', slug: 'nordlys' })
        expect(world.chainsOn('organizations')).toHaveLength(4)
    })

    it('throws when it cannot be read, and is not remembered as nobody', async () => {
        mocks.client = organizationWorld({}, () => ({ error: { message: 'down' } })).client
        await expect(organizationOfHost({ kind: 'organization', slug: 'nordlys' })).rejects.toThrow('down')
        mocks.client = organizationWorld().client
        await expect(organizationOfHost({ kind: 'organization', slug: 'nordlys' })).resolves.toMatchObject({ organizationId: NORDLYS })
    })
})

describe('the brand of a sign-in email', () => {
    it('is the organization’s for someone who works for its clients alone', async () => {
        expect((await authEmailBrand({ email: 'client@acme.test', userId: CLIENT_ADMIN })).name).toBe('Nordlys')
    })

    it('is Rerun’s for a direct customer, for the team, and for someone in both', async () => {
        for (const userId of [STRANGER, OWNER]) expect(await authEmailBrand({ email: 'x@y.test', userId })).toBe(RERUN_BRAND)
        mocks.client = organizationWorld({ workspace_members: [memberRow(CLIENT_ADMIN, CLIENT), memberRow(CLIENT_ADMIN, AGENCY_HOME)] }).client
        expect(await authEmailBrand({ email: 'client@acme.test', userId: CLIENT_ADMIN })).toBe(RERUN_BRAND)
    })

    it('is Rerun’s for someone two organizations share', async () => {
        mocks.client = organizationWorld({ workspace_members: [memberRow(CLIENT_ADMIN, CLIENT), memberRow(CLIENT_ADMIN, RIVAL_WORKSPACE)] }).client
        expect(await organizationBrandOfAccount({ email: 'client@acme.test', userId: CLIENT_ADMIN })).toBeNull()
    })

    it('is the organization’s for an address it alone invited', async () => {
        mocks.client = organizationWorld({ workspace_invitations: [{ id: 'i', workspace_id: RIVAL_WORKSPACE, email: 'new@rival.test', status: 'pending', expires_at: '2099-01-01T00:00:00Z' }] }).client
        expect(await organizationBrandOfAccount({ email: 'New@Rival.test', userId: null })).toMatchObject({ organizationId: HAVRE })
    })

    it('is Rerun’s for an address whose invitation ran out', async () => {
        mocks.client = organizationWorld({ workspace_invitations: [{ id: 'i', workspace_id: RIVAL_WORKSPACE, email: 'new@rival.test', status: 'pending', expires_at: '2020-01-01T00:00:00Z' }] }).client
        expect(await organizationBrandOfAccount({ email: 'new@rival.test', userId: null })).toBeNull()
    })

    it('never holds a sign-in back', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        mocks.client = organizationWorld({}, () => ({ error: { message: 'down' } })).client
        expect(await authEmailBrand({ email: 'client@acme.test', userId: CLIENT_ADMIN })).toBe(RERUN_BRAND)
    })
})
