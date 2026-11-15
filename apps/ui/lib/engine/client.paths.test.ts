import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelSubRun, deleteConnection, getSkill, patchConnection } from './client'

const conn = { baseUrl: 'https://engine.test', apiKey: 'k' }

function stubFetch() {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => Response.json({}))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('engine client paths', () => {
    it('encodes ids on connection routes', async () => {
        const fetchMock = stubFetch()
        await deleteConnection(conn, '../agents/a1').catch(() => undefined)
        await patchConnection(conn, 'c 1', { name: 'x' }).catch(() => undefined)
        expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual(['https://engine.test/connections/..%2Fagents%2Fa1', 'https://engine.test/connections/c%201'])
    })

    it('encodes agent, run, task and slug ids', async () => {
        const fetchMock = stubFetch()
        await cancelSubRun(conn, 'a/1', '../../update?', 't#1').catch(() => undefined)
        await getSkill(conn, 'a1', 'skill/..').catch(() => undefined)
        expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual(['https://engine.test/agents/a%2F1/runs/..%2F..%2Fupdate%3F/tasks/t%231/cancel', 'https://engine.test/agents/a1/skills/skill%2F..'])
    })
})
