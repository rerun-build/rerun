import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ servedDomainHostnames: vi.fn() }))
vi.mock('@rerun/cloud/organizations.server', () => ({ servedDomainHostnames: mocks.servedDomainHostnames }))

const list = async (key?: string) => {
    const { GET } = await import('./route')
    return GET(new Request('http://app/api/edge/domains', { headers: key === undefined ? {} : { 'x-edge-key': key } }))
}

beforeEach(() => {
    vi.stubEnv('ORGANIZATION_EDGE_KEY', 'edge-key')
    mocks.servedDomainHostnames.mockReset().mockResolvedValue(['app.acme.com', 'portal.nordlys.io'])
})
afterEach(() => vi.unstubAllEnvs())

describe('the domains the edge serves', () => {
    it('lists them one per line, never cached', async () => {
        const res = await list('edge-key')
        expect(res.status).toBe(200)
        expect(res.headers.get('Cache-Control')).toBe('no-store')
        expect(await res.text()).toBe('app.acme.com\nportal.nordlys.io\n')
    })

    it('answers an empty body when there are none', async () => {
        mocks.servedDomainHostnames.mockResolvedValue([])
        const res = await list('edge-key')
        expect(res.status).toBe(200)
        expect(await res.text()).toBe('')
    })

    it.each([undefined, '', 'wrong'])('answers %s like a route that does not exist, and reads nothing', async key => {
        expect((await list(key)).status).toBe(404)
        expect(mocks.servedDomainHostnames).not.toHaveBeenCalled()
    })

    it('has no key at all where none is set', async () => {
        vi.stubEnv('ORGANIZATION_EDGE_KEY', '')
        expect((await list('')).status).toBe(404)
    })

    it('fails rather than say there are none when it cannot read them', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        mocks.servedDomainHostnames.mockRejectedValue(new Error('down'))
        const res = await list('edge-key')
        expect(res.status).toBe(500)
        expect(await res.text()).toBe('')
    })
})
