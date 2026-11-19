import type { MemberProfile } from '@moldwright/contracts'
import { act, renderHook } from '@testing-library/react-native'

import { cachedMembers, clearLocalCache } from './local-cache'
import { forgetMemberReads, useMemberProfiles } from './useMemberProfiles'

const mockFetchMembers = jest.fn<Promise<MemberProfile[]>, []>()

jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }))
jest.mock('@/api/members', () => ({ fetchMemberProfiles: () => mockFetchMembers() }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 't' }, me: { user: { id: 'u1' }, workspace: { id: 7 } } }) }))

const ada = (name: string): MemberProfile => ({ id: 'u1', name, avatarUrl: null, role: 'member' })

describe('useMemberProfiles with a kept directory', () => {
    beforeEach(() => {
        clearLocalCache()
        forgetMemberReads()
        mockFetchMembers.mockReset()
    })

    it('signs with the kept name at once, then reads the hub once even when every author is known', async () => {
        cachedMembers(7).save({ members: [ada('Ada')], readAt: Date.now() })
        let answer: (members: MemberProfile[]) => void = () => {}
        mockFetchMembers.mockReturnValue(new Promise(resolve => (answer = resolve)))

        const { result } = await renderHook(() => useMemberProfiles(['u1']))
        expect(result.current('u1')?.name).toBe('Ada')

        await act(async () => answer([ada('Ada Lovelace')]))
        expect(mockFetchMembers).toHaveBeenCalledTimes(1)
        expect(result.current('u1')?.name).toBe('Ada Lovelace')
        expect(cachedMembers(7).read()?.members[0]?.name).toBe('Ada Lovelace')
    })

    it('does not read the hub again in the same launch when every author is known', async () => {
        cachedMembers(7).save({ members: [ada('Ada')], readAt: Date.now() })
        mockFetchMembers.mockResolvedValue([ada('Ada')])

        await renderHook(() => useMemberProfiles(['u1']))
        await act(async () => {})
        const { result } = await renderHook(() => useMemberProfiles(['u1']))
        await act(async () => {})

        expect(mockFetchMembers).toHaveBeenCalledTimes(1)
        expect(result.current('u1')?.name).toBe('Ada')
    })

    it('keeps the kept name when the hub cannot be reached, and asks again next time', async () => {
        cachedMembers(7).save({ members: [ada('Ada')], readAt: Date.now() })
        mockFetchMembers.mockRejectedValue(new Error('offline'))

        const { result } = await renderHook(() => useMemberProfiles(['u1']))
        await act(async () => {})
        expect(result.current('u1')?.name).toBe('Ada')

        mockFetchMembers.mockResolvedValue([ada('Ada Lovelace')])
        const second = await renderHook(() => useMemberProfiles(['u1']))
        await act(async () => {})
        expect(mockFetchMembers).toHaveBeenCalledTimes(2)
        expect(second.result.current('u1')?.name).toBe('Ada Lovelace')
    })
})
