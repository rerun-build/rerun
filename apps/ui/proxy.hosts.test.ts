import { RERUN_BRAND } from '@rerun/contracts'
import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ updateSession: vi.fn(), organizationOfHost: vi.fn() }))
vi.mock('@/supabase/middleware', () => ({ updateSession: mocks.updateSession }))
vi.mock('@rerun/cloud/organizations', () => ({ ORGANIZATIONS_ENABLED: true }))
vi.mock('@rerun/cloud/organizations.server', () => ({ organizationOfHost: mocks.organizationOfHost }))
vi.mock('@/lib/app-url', () => ({ APP_URL: 'https://app.rerun.build' }))

const { proxy } = await import('./proxy')

const NORDLYS = { brand: { ...RERUN_BRAND, organizationId: 'org-n', name: 'Nordlys' }, organizationId: 'org-n', suspended: false }
const HAVRE = { brand: { ...RERUN_BRAND, organizationId: 'org-h', name: 'Havre' }, organizationId: 'org-h', suspended: true }

const request = (host: string, path = '/', init: { method?: string; headers?: Record<string, string> } = {}) => new NextRequest(`https://${host}${path}`, { method: init.method, headers: { host, 'sec-fetch-dest': 'document', ...init.headers } })

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', 'rerun.work')
    vi.stubEnv('PUBLISH_HOST', 'rerun.site')
    mocks.updateSession.mockImplementation(async () => NextResponse.next())
    mocks.organizationOfHost.mockImplementation(async (address: { slug?: string; hostname?: string }) => (address.slug === 'nordlys' || address.hostname === 'app.nordlys.no' ? NORDLYS : address.slug === 'havre' ? HAVRE : null))
})
afterEach(() => vi.unstubAllEnvs())

describe('a host that is nobody’s', () => {
    it.each(['stranger.com', 'nobody.rerun.work', 'rerun.work', 'x.y.rerun.work'])('%s answers 404 and never reads a session', async host => {
        const response = await proxy(request(host, '/auth'))
        expect(response.status).toBe(404)
        expect(mocks.updateSession).not.toHaveBeenCalled()
    })

    it('is the forwarded one only under a name no visitor types', async () => {
        expect((await proxy(request('app.rerun.build', '/', { headers: { 'x-forwarded-host': 'stranger.com' } }))).status).not.toBe(404)
        expect((await proxy(request('rerun-ui:3000', '/', { headers: { 'x-forwarded-host': 'stranger.com' } }))).status).toBe(404)
    })
})

describe('an organization’s address', () => {
    it.each(['nordlys.rerun.work', 'app.nordlys.no'])('%s hands its own site to the session, and is not framed by others', async host => {
        const response = await proxy(request(host, '/'))
        expect(mocks.updateSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'organization', organizationId: 'org-n' }))
        expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'self'")
    })

    it.each(['/auth/callback', '/auth/desktop', '/i/abc', '/redeem', '/welcome', '/creator/join', '/render/lab', '/api/oauth/mobile/start', '/api/webhooks/linkup'])('has no %s', async path => {
        expect((await proxy(request('nordlys.rerun.work', path))).status).toBe(404)
        expect(mocks.updateSession).not.toHaveBeenCalled()
    })

    it('says a page is a page, and only a page', async () => {
        await proxy(request('nordlys.rerun.work', '/', { headers: { 'x-rerun-page': 'forged' } }))
        expect((mocks.updateSession.mock.calls[0][0] as NextRequest).headers.get('x-rerun-page')).toBe('1')
        await proxy(request('nordlys.rerun.work', '/', { method: 'POST', headers: { 'x-rerun-page': 'forged' } }))
        expect((mocks.updateSession.mock.calls[1][0] as NextRequest).headers.get('x-rerun-page')).toBeNull()
        await proxy(request('nordlys.rerun.work', '/api/chat', { headers: { 'x-rerun-page': 'forged' } }))
        expect((mocks.updateSession.mock.calls[2][0] as NextRequest).headers.get('x-rerun-page')).toBeNull()
    })
})

describe('a suspended organization’s address', () => {
    it('shows its page and nothing else, sign-in included', async () => {
        for (const path of ['/', '/auth', '/organization']) {
            const response = await proxy(request('havre.rerun.work', path))
            expect(response.status).toBe(403)
            expect(response.headers.get('x-middleware-rewrite')).toContain('/host-unavailable')
        }
        expect((await proxy(request('havre.rerun.work', '/api/chat', { method: 'POST' }))).status).toBe(403)
        expect(mocks.updateSession).not.toHaveBeenCalled()
    })
})

describe('Rerun’s own address', () => {
    it.each(['app.rerun.build', 'staging.rerun.build', 'localhost:3050'])('%s is untouched: no frame rule, no lookup', async host => {
        const response = await proxy(request(host, '/'))
        expect(response.headers.get('content-security-policy')).toBeNull()
        expect(mocks.organizationOfHost).not.toHaveBeenCalled()
        expect(mocks.updateSession).toHaveBeenCalledWith(expect.anything(), { kind: 'rerun' })
    })

    it('marks no page where organizations have no address', async () => {
        vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', '')
        await proxy(request('nordlys.rerun.work', '/', { headers: { 'x-rerun-page': 'forged' } }))
        expect((mocks.updateSession.mock.calls[0][0] as NextRequest).headers.get('x-rerun-page')).toBe('forged')
        expect(mocks.organizationOfHost).not.toHaveBeenCalled()
    })

    it('fails closed when the organization of a host cannot be read', async () => {
        mocks.organizationOfHost.mockRejectedValue(new Error('down'))
        await expect(proxy(request('nordlys.rerun.work', '/'))).rejects.toThrow('down')
    })
})
