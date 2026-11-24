import type { ChangeOpenChatsInput, OpenChats } from '@rerun/contracts'
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { useOpenChats } from './useOpenChats'

const mockSecure = new Map<string, string>()
const mockFiles = new Map<string, string>()
const mockAuth = { session: { access_token: 'token' }, me: { user: { id: 'ada' }, workspace: { id: 7 } } as { user: { id: string }; workspace: { id: number } } | null }
const mockFetch = jest.fn<Promise<OpenChats>, [unknown, string]>()
const mockChange = jest.fn<Promise<OpenChats>, [unknown, string, ChangeOpenChatsInput]>()

jest.mock('expo-secure-store', () => ({
    getItem: (key: string) => mockSecure.get(key) ?? null,
    setItemAsync: jest.fn(async (key: string, value: string) => void mockSecure.set(key, value)),
}))
jest.mock('expo-crypto', () => ({ randomUUID: () => '22222222-2222-4222-8222-222222222222' }))
jest.mock('expo-file-system', () => ({
    Paths: { document: 'document' },
    Directory: function (_root: unknown, mockPath: string) {
        return { path: mockPath, create: () => {} }
    },
    File: function (mockFolder: { path: string }, mockName: string) {
        const path = `${mockFolder.path}/${mockName}`
        return {
            get exists() {
                return mockFiles.has(path)
            },
            textSync: () => mockFiles.get(path),
            write: (value: string) => void mockFiles.set(path, value),
        }
    },
}))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockAuth }))
jest.mock('@/api/client', () => ({ ApiError: class ApiError extends Error {} }))
jest.mock('@/api/open-chats', () => ({
    fetchOpenChats: (caller: unknown, agentId: string) => mockFetch(caller, agentId),
    changeOpenChats: (caller: unknown, agentId: string, body: ChangeOpenChatsInput) => mockChange(caller, agentId, body),
}))

const COMPUTER = '11111111-1111-4111-8111-111111111111'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const answer = (ids: string[], activeId: string | null = null): OpenChats => ({ chats: ids.map(id => ({ id, title: `Title ${id[0]}` })), last: { activeId, deviceId: COMPUTER, deviceKind: 'computer', changedAt: '2026-11-24T09:00:00.000Z' } })

// One coworker per test: what the hook shares between two visits lives as long as the app.
let agents = 0
let agentId = ''
const keep = (openIds: string[], merged = true) => mockFiles.set(`open-chats/ada-7-${agentId}.json`, JSON.stringify({ openIds, memo: { pending: [], merged, dismissedAt: null } }))
const kept = () => JSON.parse(mockFiles.get(`open-chats/ada-7-${agentId}.json`)!) as { openIds: string[]; memo: { pending: unknown[]; dismissedAt: string | null } }
const open = (options: Parameters<typeof useOpenChats>[1] = { openedOn: null, activeId: null }) => renderHook(() => useOpenChats(agentId, options))
const settled = () => act(async () => {})

let onAppState: (state: string) => void = () => {}

describe('the conversations left open on a coworker', () => {
    beforeEach(() => {
        mockSecure.clear()
        mockFiles.clear()
        jest.clearAllMocks()
        agentId = `pulse-${++agents}`
        mockAuth.me = { user: { id: 'ada' }, workspace: { id: 7 } }
        mockFetch.mockResolvedValue(answer([]))
        mockChange.mockResolvedValue(answer([]))
        jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
            onAppState = listener as (state: string) => void
            return { remove: () => {} } as never
        })
    })

    // Read before the first frame: the pages never shift under the one opened.
    it('opens on what the phone kept, then shows what the hub holds', async () => {
        keep([A])
        let reply: (value: OpenChats) => void = () => {}
        mockFetch.mockReturnValue(new Promise(resolve => (reply = resolve)))
        const { result } = await open()
        expect(result.current.openIds).toEqual([A])
        await act(async () => reply(answer([B, C])))
        expect(result.current.openIds).toEqual([B, C])
        expect(kept().openIds).toEqual([B, C])
    })

    it('offers the conversation picked on another device', async () => {
        keep([])
        mockFetch.mockResolvedValue(answer([A, B], B))
        const { result } = await open()
        await settled()
        expect(result.current.resume).toMatchObject({ sessionId: B, title: 'Title b', deviceKind: 'computer' })
    })

    it('does not offer again what was dismissed', async () => {
        keep([])
        mockFetch.mockResolvedValue(answer([A], A))
        const first = await open()
        await settled()
        await act(async () => first.result.current.dismiss())
        expect(first.result.current.resume).toBeNull()
        await act(async () => first.unmount())
        const second = await open()
        await settled()
        expect(second.result.current.resume).toBeNull()
    })

    it('offers nothing when opened on a conversation, and tells the hub it was picked', async () => {
        keep([])
        mockChange.mockResolvedValue(answer([A, B], A))
        const { result } = await open({ openedOn: B, activeId: B })
        await settled()
        expect(mockChange.mock.calls[0][2].changes).toEqual([{ type: 'select', sessionId: B }])
        expect(result.current.openIds).toEqual([A, B])
        expect(result.current.resume).toBeNull()
    })

    it('merges what the app kept before the hub did, once', async () => {
        mockSecure.set(`rerun.open-chats.${agentId}`, JSON.stringify([A]))
        mockChange.mockResolvedValue(answer([B, A]))
        const { result } = await open()
        await settled()
        expect(mockChange.mock.calls[0][2].merge).toEqual([A])
        expect(result.current.openIds).toEqual([B, A])
    })

    it('closes a conversation onto its neighbour, and drops the offer of it', async () => {
        keep([A, B])
        mockFetch.mockResolvedValue(answer([A, B], B))
        const { result } = await open()
        await settled()
        let next: string | null = null
        await act(async () => {
            next = result.current.close(B)
        })
        expect(next).toBe(A)
        expect(result.current.openIds).toEqual([A])
        expect(result.current.resume).toBeNull()
        await act(async () => onAppState('background'))
        expect(mockChange.mock.calls[0][2].changes).toEqual([{ type: 'close', sessionId: B }])
    })

    it('works offline, and owes the hub what changed', async () => {
        keep([A])
        mockFetch.mockRejectedValue(new Error('offline'))
        mockChange.mockRejectedValue(new Error('offline'))
        const { result } = await open()
        await settled()
        await act(async () => result.current.select(B))
        expect(result.current.openIds).toEqual([A, B])
        await act(async () => onAppState('background'))
        expect(kept()).toMatchObject({ openIds: [A, B], memo: { pending: [{ type: 'select', sessionId: B }] } })
    })

    it('never writes over what the phone kept while the account is being read', async () => {
        keep([A])
        mockAuth.me = null
        const { result, rerender } = await open()
        expect(result.current.openIds).toEqual([])
        mockAuth.me = { user: { id: 'ada' }, workspace: { id: 7 } }
        mockFetch.mockReturnValue(new Promise(() => {}))
        await act(async () => rerender({}))
        expect(result.current.openIds).toEqual([A])
        expect(kept().openIds).toEqual([A])
    })
})
