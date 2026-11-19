import type { BoardAgent } from '@rerun/contracts'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { useBuddyLookOf } from '@/components/buddy/looks'
import { forgetHub, loadHub } from '@/data/hub-store'
import { clearLocalCache } from '@/data/local-cache'
import { boardKey } from '@/data/useBoard'

import { CoworkerLooks } from './CoworkerLooks'

const mockFetchBoard = jest.fn()

jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }))
jest.mock('@/api/board', () => ({ fetchBoard: () => mockFetchBoard() }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 't', user: { id: 'u1' } }, me: { user: { id: 'u1' }, workspace: { id: 7 } } }) }))
jest.mock('@/auth/supabase', () => ({ supabase: require('@/test/realtime').fakeSupabase }))

const LOOK = { eyes: 'heart', mouth: 'cat', color: '#00b862' } as const
const agent = (id: string, look: BoardAgent['look']): BoardAgent => ({ id, name: id, handle: id, description: null, templateId: null, status: 'idle', workspaceId: 7, spaceId: 'box', disabledAt: null, disabledReason: null, look })
const wrapper = ({ children }: { children: ReactNode }) => <CoworkerLooks>{children}</CoworkerLooks>

describe('CoworkerLooks', () => {
    beforeEach(() => {
        clearLocalCache()
        forgetHub()
        mockFetchBoard.mockReset()
    })

    it('dresses a buddy in the look the Home read, without asking the hub itself', async () => {
        const dressed = await renderHook(() => useBuddyLookOf('dressed'), { wrapper })
        const plain = await renderHook(() => useBuddyLookOf('plain'), { wrapper })
        expect(dressed.result.current).toEqual({})

        await act(() => loadHub(boardKey(7), async () => ({ agents: [agent('dressed', LOOK), agent('plain', null)], overview: { agents: [] }, boxes: [] })))

        expect(dressed.result.current).toEqual(LOOK)
        expect(plain.result.current).toEqual({})
        expect(mockFetchBoard).not.toHaveBeenCalled()
    })
})
