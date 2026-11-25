import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ enabled: true }))
vi.mock('@rerun/cloud/organizations', () => ({ get ORGANIZATIONS_ENABLED() { return mocks.enabled } }))
vi.mock('@/lib/app-url', () => ({ APP_URL: 'https://app.rerun.build' }))

const { classifyHost, edgeHostname, organizationDefaultOrigin, organizationOrigin } = await import('./host')
const { isRerunOnlyPath } = await import('./host-paths')

beforeEach(() => {
    mocks.enabled = true
    vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', 'rerun.work')
    vi.stubEnv('PUBLISH_HOST', 'rerun.site')
})
afterEach(() => vi.unstubAllEnvs())

describe('whose a host is', () => {
    it.each([
        ['app.rerun.build', { kind: 'rerun' }],
        ['APP.RERUN.BUILD:443', { kind: 'rerun' }],
        ['staging.rerun.build', { kind: 'rerun' }],
        ['test-1.rerun.build', { kind: 'rerun' }],
        ['localhost:3050', { kind: 'rerun' }],
        ['127.0.0.1:3000', { kind: 'rerun' }],
        ['[::1]:3000', { kind: 'rerun' }],
        ['rerun-ui-abc123:3000', { kind: 'rerun' }],
        ['10.0.1.7', { kind: 'rerun' }],
        [null, { kind: 'rerun' }],
        ['my-page-k3m9xqw7pt.rerun.site', { kind: 'published', slug: 'my-page-k3m9xqw7pt' }],
        ['www.rerun.site', { kind: 'unknown' }],
        ['rerun.site', { kind: 'unknown' }],
        ['nordlys.rerun.work', { kind: 'organization', slug: 'nordlys' }],
        ['Nordlys.Rerun.Work:8443', { kind: 'organization', slug: 'nordlys' }],
        ['nordlys.rerun.work.', { kind: 'organization', slug: 'nordlys' }],
        ['rerun.work', { kind: 'unknown' }],
        ['a.nordlys.rerun.work', { kind: 'unknown' }],
        ['-x.rerun.work', { kind: 'unknown' }],
        ['app.acme.com', { kind: 'domain', hostname: 'app.acme.com' }],
        ['acme.com', { kind: 'domain', hostname: 'acme.com' }],
        ['xn--caf-dma.example', { kind: 'domain', hostname: 'xn--caf-dma.example' }],
        ['notrerun.build', { kind: 'domain', hostname: 'notrerun.build' }],
        ['app.rerun.build.evil.com', { kind: 'domain', hostname: 'app.rerun.build.evil.com' }],
        ['notrerun.work', { kind: 'domain', hostname: 'notrerun.work' }],
        ['rerun.work.evil.com', { kind: 'domain', hostname: 'rerun.work.evil.com' }],
    ])('%s', (host, kind) => {
        expect(classifyHost(host)).toEqual(kind)
    })

    it.each(['hub.acme.com', 'nordlys.rerun.work', 'anything.example'])('%s is the app’s own where organizations have no address', host => {
        vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', '')
        expect(classifyHost(host)).toEqual({ kind: 'rerun' })
    })

    it('is the app’s own on a self-hosted install, root domain or not, and a published page stays one', () => {
        mocks.enabled = false
        expect(classifyHost('nordlys.rerun.work')).toEqual({ kind: 'rerun' })
        expect(classifyHost('hub.acme.com')).toEqual({ kind: 'rerun' })
        expect(classifyHost('page.rerun.site')).toEqual({ kind: 'published', slug: 'page' })
    })
})

describe('the addresses', () => {
    it('are https without a port in production, and the dev server’s locally', async () => {
        expect(organizationDefaultOrigin('nordlys')).toBe('https://nordlys.rerun.work')
        expect(organizationOrigin('nordlys', null)).toBe('https://nordlys.rerun.work')
        expect(organizationOrigin('nordlys', 'app.nordlys.no')).toBe('https://app.nordlys.no')
        expect(edgeHostname()).toBe('edge.rerun.work')

        vi.resetModules()
        vi.doMock('@/lib/app-url', () => ({ APP_URL: 'http://localhost:55140' }))
        vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', 'agency.test')
        const local = await import('./host')
        expect(local.organizationDefaultOrigin('nordlys')).toBe('http://nordlys.agency.test:55140')
    })

    it('do not exist without a root domain', () => {
        vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', ' ')
        expect(organizationDefaultOrigin('nordlys')).toBeNull()
        expect(organizationOrigin('nordlys', 'app.nordlys.no')).toBeNull()
        expect(edgeHostname()).toBeNull()
    })
})

describe('what only Rerun’s address has', () => {
    it.each(['/auth/callback', '/auth/desktop', '/i/clement', '/redeem', '/creator/join/x', '/welcome', '/render/lab', '/api/oauth/mobile/start', '/api/oauth/host/start', '/api/webhooks/stripe', '/api/engines/pair', '/experts/x/card.png'])('%s', path => {
        expect(isRerunOnlyPath(path)).toBe(true)
    })

    it.each(['/', '/auth', '/auth/confirm', '/invite/tok', '/organization', '/organization/invite/tok', '/unsubscribe', '/api/oauth/claim', '/api/mcp/oauth/callback', '/api/oauth/composio/callback', '/api/chat', '/authors', '/inbox', '/redeemed'])('%s is not', path => {
        expect(isRerunOnlyPath(path)).toBe(false)
    })
})
