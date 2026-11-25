import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isServedHostname: vi.fn() }))
vi.mock('@rerun/cloud/organizations.server', () => ({ isServedHostname: mocks.isServedHostname }))

const ask = async (query: string) => {
    const { GET } = await import('./route')
    return GET(new Request(`http://app/api/edge/ask?${query}`))
}

beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('ORGANIZATION_EDGE_KEY', 'edge-key')
    mocks.isServedHostname.mockReset().mockImplementation(async (name: string) => name === 'nordlys.rerun.work')
})
afterEach(() => vi.unstubAllEnvs())

describe('the ask of the edge', () => {
    it('says yes to a name served, no to anything else, with nothing in the body', async () => {
        const yes = await ask('domain=nordlys.rerun.work&key=edge-key')
        expect(yes.status).toBe(200)
        expect(await yes.text()).toBe('')
        expect((await ask('domain=NORDLYS.rerun.work&key=edge-key')).status).toBe(200)
        expect((await ask('domain=nobody.rerun.work&key=edge-key')).status).toBe(404)
        expect((await ask('key=edge-key')).status).toBe(404)
    })

    it.each(['domain=nordlys.rerun.work', 'domain=nordlys.rerun.work&key=wrong', 'domain=nordlys.rerun.work&key='])('answers %s like a name nobody has, and asks nothing', async query => {
        expect((await ask(query)).status).toBe(404)
        expect(mocks.isServedHostname).not.toHaveBeenCalled()
    })

    it('has no key at all where none is set', async () => {
        vi.stubEnv('ORGANIZATION_EDGE_KEY', '')
        expect((await ask('domain=nordlys.rerun.work&key=')).status).toBe(404)
    })

    it('answers no rather than fail when it cannot look', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        mocks.isServedHostname.mockRejectedValue(new Error('down'))
        expect((await ask('domain=nordlys.rerun.work&key=edge-key')).status).toBe(404)
    })

    it('stops answering made-up names past its pace, and still says yes to a name it serves', async () => {
        const { GET } = await import('./route')
        const made = (n: number) => GET(new Request(`http://app/api/edge/ask?domain=x${n}.rerun.work&key=edge-key`))
        const statuses: number[] = []
        for (let i = 0; i < 305; i++) statuses.push((await made(i)).status)
        expect(statuses.slice(0, 300).every(status => status === 404)).toBe(true)
        expect(statuses.slice(300)).toEqual([429, 429, 429, 429, 429])
        expect((await GET(new Request('http://app/api/edge/ask?domain=nordlys.rerun.work&key=edge-key'))).status).toBe(200)
    })

    it('never counts a name it serves against that pace', async () => {
        const { GET } = await import('./route')
        for (let i = 0; i < 305; i++) expect((await GET(new Request('http://app/api/edge/ask?domain=nordlys.rerun.work&key=edge-key'))).status).toBe(200)
        expect((await GET(new Request('http://app/api/edge/ask?domain=nobody.rerun.work&key=edge-key'))).status).toBe(404)
    })
})
