import { FOREMAN_AGENT_ID, type AgentView, type BoardAgent, type BoxAccessLevel } from '@moldwright/contracts'
import { act, renderHook } from '@testing-library/react-native'

import { UNKNOWN_ACCESS } from '@/auth/access'
import { cachedBoard, clearLocalCache, saveCoworkerScreen } from '@/data/local-cache'

import { useCoworkerAccess } from './useCoworkerAccess'

const mockFetchAgentView = jest.fn<Promise<AgentView>, []>()

jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }))
jest.mock('@/api/chat', () => ({ fetchAgentView: () => mockFetchAgentView() }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 't' }, me: { user: { id: 'u1' }, workspace: { id: 7 } } }) }))

const agent = (id: string, access?: BoxAccessLevel): BoardAgent => ({ id, name: id, handle: null, description: null, templateId: null, status: 'idle', workspaceId: 7, spaceId: 's1', disabledAt: null, disabledReason: null, access })
const viewOf = (id: string, access?: BoxAccessLevel): AgentView => ({ agent: agent(id, access), detail: null, locked: false })

const pending = () => {
    let answer: (view: AgentView) => void = () => {}
    mockFetchAgentView.mockReturnValue(new Promise(resolve => (answer = resolve)))
    return (view: AgentView) => act(async () => answer(view))
}

describe('useCoworkerAccess', () => {
    beforeEach(() => {
        clearLocalCache()
        mockFetchAgentView.mockReset()
    })

    it('answers from the board at once, then takes the hub word, even when it takes the Box back', async () => {
        cachedBoard(7).save({ agents: [agent('a1', 'manage')], overview: [], boxes: [] })
        const answer = pending()

        const { result } = await renderHook(() => useCoworkerAccess('a1'))
        expect(result.current).toEqual({ access: 'manage', known: true })

        await answer(viewOf('a1', 'use'))
        expect(result.current).toEqual({ access: 'use', known: true })
        expect(mockFetchAgentView).toHaveBeenCalledTimes(1)
    })

    it('falls back on the chat screen copy when the board does not list the coworker', async () => {
        saveCoworkerScreen(7, 'a1', { view: viewOf('a1', 'use') })
        pending()

        const { result } = await renderHook(() => useCoworkerAccess('a1'))
        expect(result.current).toEqual({ access: 'use', known: true })
    })

    it('stays unknown until the hub answers when nothing was kept', async () => {
        const answer = pending()

        const { result } = await renderHook(() => useCoworkerAccess('a1'))
        expect(result.current).toEqual(UNKNOWN_ACCESS)

        await answer(viewOf('a1', 'manage'))
        expect(result.current).toEqual({ access: 'manage', known: true })
    })

    it('keeps the kept copy when the hub cannot be reached', async () => {
        cachedBoard(7).save({ agents: [agent('a1', 'use')], overview: [], boxes: [] })
        mockFetchAgentView.mockRejectedValue(new Error('offline'))

        const { result } = await renderHook(() => useCoworkerAccess('a1'))
        await act(async () => {})
        expect(result.current).toEqual({ access: 'use', known: true })
    })

    it('hands the Foreman to everyone without asking the hub', async () => {
        const { result } = await renderHook(() => useCoworkerAccess(FOREMAN_AGENT_ID))
        await act(async () => {})
        expect(result.current).toEqual({ access: 'manage', known: true })
        expect(mockFetchAgentView).not.toHaveBeenCalled()
    })
})
