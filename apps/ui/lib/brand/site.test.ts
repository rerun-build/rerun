import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RERUN_BRAND, type Brand } from '@rerun/contracts'

const mocks = vi.hoisted(() => ({ host: null as string | null, forwarded: null as string | null, organizationOfHost: vi.fn(), loadPublished: vi.fn(), workspaceBrand: vi.fn() }))
vi.mock('react', async importOriginal => ({ ...(await importOriginal<object>()), cache: (read: unknown) => read }))
vi.mock('next/headers', () => ({
    headers: async () => new Headers({ ...(mocks.host ? { host: mocks.host } : {}), ...(mocks.forwarded ? { 'x-forwarded-host': mocks.forwarded } : {}) }),
}))
vi.mock('next/navigation', () => ({
    notFound: () => {
        throw new Error('NOT FOUND')
    },
}))
vi.mock('@/lib/app-url', () => ({ APP_URL: 'https://app.rerun.build' }))
vi.mock('@rerun/cloud/organizations', () => ({ ORGANIZATIONS_ENABLED: true }))
vi.mock('@rerun/cloud/organizations.server', () => ({ organizationOfHost: mocks.organizationOfHost }))
vi.mock('@/lib/published/gate', () => ({ loadPublished: mocks.loadPublished }))
vi.mock('./workspace', () => ({ workspaceBrand: mocks.workspaceBrand }))

const { getBrand } = await import('./server')
const { hostOrganizationId, isRerunHost } = await import('./request-site')
const { requestHostScope } = await import('./host-scope')
const { hostSite, organizationOfOrigin } = await import('./site')

const brand = (organizationId: string, name: string): Brand => ({ ...RERUN_BRAND, organizationId, name, appUrl: `https://${name.toLowerCase()}.rerun.work` })
const NORDLYS = { brand: brand('org-nordlys', 'Nordlys'), organizationId: 'org-nordlys', suspended: false }
const HAVRE = { brand: brand('org-havre', 'Havre'), organizationId: 'org-havre', suspended: true }

beforeEach(() => {
    vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', 'rerun.work')
    vi.stubEnv('PUBLISH_HOST', 'rerun.site')
    mocks.host = 'app.rerun.build'
    mocks.forwarded = null
    mocks.organizationOfHost.mockReset().mockImplementation(async (address: { slug?: string; hostname?: string }) => (address.slug === 'nordlys' || address.hostname === 'app.nordlys.no' ? NORDLYS : address.slug === 'havre' ? HAVRE : null))
    mocks.loadPublished.mockReset().mockResolvedValue({ workspace_id: 7 })
    mocks.workspaceBrand.mockReset().mockResolvedValue(NORDLYS.brand)
    return () => vi.unstubAllEnvs()
})

describe('the brand of a request', () => {
    it.each(['nordlys.rerun.work', 'app.nordlys.no'])('is the organization’s on %s', async host => {
        mocks.host = host
        expect(await getBrand()).toBe(NORDLYS.brand)
        expect(await hostOrganizationId()).toBe('org-nordlys')
        expect(await isRerunHost()).toBe(false)
    })

    it('is Rerun’s on its own address, whoever asks for another in a header, and nothing is read', async () => {
        mocks.forwarded = 'nordlys.rerun.work'
        expect(await getBrand()).toBe(RERUN_BRAND)
        expect(await isRerunHost()).toBe(true)
        expect(mocks.organizationOfHost).not.toHaveBeenCalled()
    })

    it('is the one of the workspace on a published page, and Rerun’s on a link that is gone', async () => {
        mocks.host = 'page.rerun.site'
        expect(await getBrand()).toBe(NORDLYS.brand)
        expect(mocks.workspaceBrand).toHaveBeenCalledWith(7)
        mocks.loadPublished.mockResolvedValue(null)
        expect(await getBrand()).toBe(RERUN_BRAND)
    })

    it.each(['stranger.com', 'nobody.rerun.work', 'rerun.work', 'rerun.site'])('is none on %s, which is nobody’s', async host => {
        mocks.host = host
        await expect(getBrand()).rejects.toThrow('NOT FOUND')
        expect(await isRerunHost()).toBe(false)
        expect(await hostOrganizationId()).toBeNull()
    })

    it('is Rerun’s on any host where organizations have no address', async () => {
        vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', '')
        for (const host of ['hub.acme.com', 'nordlys.rerun.work', 'stranger.com']) {
            mocks.host = host
            expect(await getBrand()).toBe(RERUN_BRAND)
        }
        expect(mocks.organizationOfHost).not.toHaveBeenCalled()
    })

    it('is never Rerun’s in place of an organization that could not be read', async () => {
        mocks.host = 'nordlys.rerun.work'
        mocks.organizationOfHost.mockRejectedValue(new Error('down'))
        await expect(getBrand()).rejects.toThrow('down')
    })
})

describe('the workspaces a host opens', () => {
    it.each([
        ['app.rerun.build', { organizationId: null }],
        ['nordlys.rerun.work', { organizationId: 'org-nordlys' }],
        ['havre.rerun.work', { organizationId: 'nobody' }],
        ['stranger.com', { organizationId: 'nobody' }],
    ])('%s', async (host, scope) => {
        mocks.host = host
        expect(await requestHostScope()).toEqual(scope)
    })

    it('are any, anywhere, where organizations have no address', async () => {
        vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', '')
        mocks.host = 'nordlys.rerun.work'
        expect(await requestHostScope()).toBeNull()
    })
})

describe('an address to go back to', () => {
    it.each(['https://nordlys.rerun.work', 'https://app.nordlys.no'])('is %s while it is served', async origin => {
        expect(await organizationOfOrigin(origin)).toEqual({ organizationId: 'org-nordlys' })
    })

    it.each([
        'https://stranger.com',
        'https://app.rerun.build',
        'https://havre.rerun.work',
        'https://nobody.rerun.work',
        'https://nordlys.rerun.work.evil.com',
        'https://nordlys.rerun.work@evil.com',
        'https://nordlys.rerun.work/path',
        'https://page.rerun.site',
        'javascript:alert(1)',
        'nordlys.rerun.work',
        '',
    ])('is never %j', async origin => {
        expect(await organizationOfOrigin(origin)).toBeNull()
    })
})

it('classifies a suspended organization as suspended, not as nobody', async () => {
    expect(await hostSite('havre.rerun.work')).toMatchObject({ kind: 'organization', suspended: true })
})
