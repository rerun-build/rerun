import { forgetPreloads, preloadGenerals } from './preload'

const mockLoad = jest.fn(async (_workspaceId: number, _sessionId: string, _fetch: unknown) => ({ messages: [], unchanged: true, updatedAt: null }))
jest.mock('@/data/local-cache', () => ({ loadTranscript: (workspaceId: number, sessionId: string, fetch: unknown) => mockLoad(workspaceId, sessionId, fetch) }))
jest.mock('@/chat/endpoints', () => ({ coworkerEndpoints: () => ({ messages: jest.fn() }) }))

const caller = { accessToken: 't', workspaceId: 7 }
const coworker = (id: string, updatedAt: string | null, generalSessionId: string | null = `general-${id}`) => ({ id, generalSessionId, latest: updatedAt ? { updatedAt } : null })

describe('preloading the Generals', () => {
    beforeEach(() => {
        forgetPreloads()
        mockLoad.mockClear()
    })

    it('reads the Generals of the coworkers talked to last, one after the other', async () => {
        await preloadGenerals(caller, [coworker('a', '2026-11-19T08:00:00Z'), coworker('b', '2026-11-19T09:00:00Z'), coworker('never', null), coworker('none', '2026-11-19T10:00:00Z', null), coworker('c', '2026-11-19T07:00:00Z'), coworker('d', '2026-11-19T06:00:00Z'), coworker('e', '2026-11-19T05:00:00Z')])
        expect(mockLoad.mock.calls.map(call => call[1])).toEqual(['general-b', 'general-a', 'general-c', 'general-d'])
    })

    it('does not read them again for a while', async () => {
        await preloadGenerals(caller, [coworker('a', '2026-11-19T08:00:00Z')], 1_000_000)
        await preloadGenerals(caller, [coworker('a', '2026-11-19T08:00:00Z')], 1_000_000 + 60_000)
        await preloadGenerals(caller, [coworker('a', '2026-11-19T08:00:00Z')], 1_000_000 + 6 * 60_000)
        expect(mockLoad).toHaveBeenCalledTimes(2)
    })
})
