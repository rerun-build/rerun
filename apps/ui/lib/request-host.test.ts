import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ enabled: true }))
vi.mock('@rerun/cloud/organizations', () => ({ get ORGANIZATIONS_ENABLED() { return mocks.enabled } }))

const { hostnameOf, isInternalHostname, requestHost, requestOrigin } = await import('./request-host')

const headers = (values: Record<string, string>) => new Headers(values)

beforeEach(() => {
    mocks.enabled = true
})
afterEach(() => vi.unstubAllEnvs())

describe('the host of a request, on a self-hosted install', () => {
    it.each([
        ['the host alone', { host: 'hub.acme.com:3000' }, 'hub.acme.com:3000'],
        ['a reverse proxy that rewrites it', { host: 'app:3000', 'x-forwarded-host': 'hub.acme.com' }, 'hub.acme.com'],
        ['two proxies that each append theirs', { host: 'app:3000', 'x-forwarded-host': 'hub.acme.com, proxy.internal' }, 'hub.acme.com'],
        ['an uppercase spelling', { host: 'Hub.Acme.com' }, 'hub.acme.com'],
        ['nothing', {}, null],
    ])('reads %s', (_case, values, host) => {
        expect(requestHost(headers(values))).toBe(host)
    })

    it('stays the forwarded one when a root domain is set on an edition without organizations', () => {
        mocks.enabled = false
        vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', 'rerun.work')
        expect(requestHost(headers({ host: 'a.com', 'x-forwarded-host': 'b.com' }))).toBe('b.com')
    })
})

describe('the host of a request, where organizations are served', () => {
    beforeEach(() => vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', 'rerun.work'))

    it.each([
        ['what the visitor typed', { host: 'nordlys.rerun.work', 'x-forwarded-host': 'nordlys.rerun.work' }, 'nordlys.rerun.work'],
        ['Host, whatever else a caller claims', { host: 'app.rerun.build', 'x-forwarded-host': 'nordlys.rerun.work' }, 'app.rerun.build'],
        ['the forwarded one under a container name', { host: 'rerun-ui:3000', 'x-forwarded-host': 'nordlys.rerun.work' }, 'nordlys.rerun.work'],
        ['the forwarded one when the server calls itself', { host: 'localhost:3000', 'x-forwarded-host': 'nordlys.rerun.work, edge' }, 'nordlys.rerun.work'],
        ['an address nothing forwards', { host: '10.0.0.4:3000' }, '10.0.0.4:3000'],
    ])('is %s', (_case, values, host) => {
        expect(requestHost(headers(values))).toBe(host)
    })
})

describe('requestOrigin', () => {
    it('takes the first forwarded protocol, http on this machine, https elsewhere', () => {
        expect(requestOrigin(headers({ host: 'app.rerun.build', 'x-forwarded-proto': 'https, http' }))).toBe('https://app.rerun.build')
        expect(requestOrigin(headers({ host: 'localhost:3050' }))).toBe('http://localhost:3050')
        expect(requestOrigin(headers({ host: 'hub.acme.com' }))).toBe('https://hub.acme.com')
        expect(requestOrigin(headers({}))).toBe('http://localhost:3000')
    })
})

describe('hostnameOf and isInternalHostname', () => {
    it.each([
        ['App.Rerun.build:443', 'app.rerun.build'],
        ['app.rerun.build.', 'app.rerun.build'],
        ['[::1]:3000', '[::1]'],
        ['localhost', 'localhost'],
    ])('reads %s', (host, hostname) => {
        expect(hostnameOf(host)).toBe(hostname)
    })

    it.each(['localhost', 'rerun-ui', '127.0.0.1', '10.0.0.4', '[::1]', 'page.localhost'])('%s is internal', hostname => {
        expect(isInternalHostname(hostname)).toBe(true)
    })

    it.each(['rerun.work', 'a.b', '1.2.3.4.example.com'])('%s is not', hostname => {
        expect(isInternalHostname(hostname)).toBe(false)
    })
})
