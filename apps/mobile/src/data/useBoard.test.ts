import type { BoardAgent } from '@rerun/contracts'
import { act, renderHook } from '@testing-library/react-native'

import type { BoardRead } from '@/api/board'
import { cachedBoard, clearLocalCache } from '@/data/local-cache'
import { realtime } from '@/test/realtime'

import { useBoard } from './useBoard'

const mockFetchBoard = jest.fn<Promise<BoardRead>, []>()

jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }))
jest.mock('@/api/board', () => ({ fetchBoard: () => mockFetchBoard() }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 't' }, me: { user: { id: 'u1' }, workspace: { id: 7 } } }) }))
jest.mock('@/auth/supabase', () => ({ supabase: require('@/test/realtime').fakeSupabase }))

const agent = (id: string, name: string, status: BoardAgent['status'] = 'idle'): BoardAgent => ({ id, name, handle: null, description: null, templateId: null, status, workspaceId: 7, spaceId: 's1', disabledAt: null, disabledReason: null })
const boardWith = (...agents: BoardAgent[]): BoardRead => ({ agents, overview: [], boxes: [] })

// Several rows move at once when a run starts: the home reads once for the burst.
const BURST_MS = 400

describe('useBoard', () => {
    beforeEach(() => {
        clearLocalCache()
        mockFetchBoard.mockReset()
        realtime.reset()
    })

    it('listens to the Boxes named to the caller, so one handed over or taken back reaches the home', async () => {
        mockFetchBoard.mockResolvedValue(boardWith())
        await renderHook(() => useBoard())
        await act(async () => {})
        expect(realtime.live().flatMap(channel => channel.bindings)).toContainEqual(expect.objectContaining({ table: 'space_members', filter: 'user_id=eq.u1' }))
    })

    it('opens on the rows kept from the last visit, then on the hub copy', async () => {
        cachedBoard(7).save(boardWith(agent('a1', 'Scout')))
        let answer: (board: BoardRead) => void = () => {}
        mockFetchBoard.mockReturnValue(new Promise(resolve => (answer = resolve)))

        const { result } = await renderHook(() => useBoard())
        expect(result.current).toMatchObject({ state: 'ready', fresh: false, coworkers: [{ name: 'Scout' }] })

        await act(async () => answer(boardWith(agent('a1', 'Scout'), agent('a2', 'Writer'))))
        expect(result.current).toMatchObject({ state: 'ready', fresh: true })
        expect(result.current.state === 'ready' && result.current.coworkers).toHaveLength(2)
        expect(cachedBoard(7).read()?.agents).toHaveLength(2)
    })

    it('stays on the kept rows when the hub cannot be reached', async () => {
        cachedBoard(7).save(boardWith(agent('a1', 'Scout')))
        mockFetchBoard.mockRejectedValue(new Error('offline'))

        const { result } = await renderHook(() => useBoard())
        await act(async () => {})

        expect(result.current).toMatchObject({ state: 'ready', fresh: false })
    })

    it('falls on the error when nothing was kept', async () => {
        mockFetchBoard.mockRejectedValue(new Error('offline'))

        const { result } = await renderHook(() => useBoard())
        await act(async () => {})

        expect(result.current.state).toBe('error')
    })

    describe('a chat started on the web while Realtime was away (RER-7)', () => {
        beforeEach(() => jest.useFakeTimers())
        afterEach(() => jest.useRealTimers())

        it('reads the board again when the channel joins again after a drop, as Realtime does not replay what it missed', async () => {
            mockFetchBoard.mockResolvedValueOnce(boardWith(agent('a1', 'Scout'))).mockResolvedValue(boardWith(agent('a1', 'Scout', 'working')))
            const { result } = await renderHook(() => useBoard())
            await act(async () => realtime.report('SUBSCRIBED'))
            await act(async () => jest.advanceTimersByTime(BURST_MS))
            expect(mockFetchBoard).toHaveBeenCalledTimes(1)

            await act(async () => realtime.report('SUBSCRIBED'))
            await act(async () => jest.advanceTimersByTime(BURST_MS))

            expect(mockFetchBoard).toHaveBeenCalledTimes(2)
            expect(result.current.state === 'ready' && result.current.coworkers[0].status).toBe('working')
        })

        it('opens a channel again when the server closed it, and hears the changes on it', async () => {
            mockFetchBoard.mockResolvedValueOnce(boardWith(agent('a1', 'Scout'))).mockResolvedValue(boardWith(agent('a1', 'Scout', 'working')))
            const { result } = await renderHook(() => useBoard())
            await act(async () => realtime.report('SUBSCRIBED'))
            const [closed] = realtime.live()

            await act(async () => realtime.report('CLOSED'))
            await act(async () => jest.advanceTimersByTime(15_000))

            const [reopened] = realtime.live()
            expect(closed.removed).toBe(true)
            expect(reopened).toBeDefined()
            expect(reopened.bindings.map(({ event, table, filter }) => ({ event, table, filter }))).toEqual(closed.bindings.map(({ event, table, filter }) => ({ event, table, filter })))

            await act(async () => realtime.change('sessions'))
            await act(async () => jest.advanceTimersByTime(BURST_MS))
            expect(result.current.state === 'ready' && result.current.coworkers[0].status).toBe('working')
        })
    })
})
