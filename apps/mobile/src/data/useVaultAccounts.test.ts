import type { CoworkerVaultAccounts } from '@rerun/contracts'
import { act, renderHook } from '@testing-library/react-native'

import { useVaultAccounts } from './useVaultAccounts'

const settled = () => act(async () => {})

const mockRead = jest.fn<Promise<CoworkerVaultAccounts>, [unknown, string]>()
const mockLend = jest.fn<Promise<void>, [unknown, string, string]>()

jest.mock('@/api/vault', () => ({ readVaultAccounts: (...args: [unknown, string]) => mockRead(...args), lendVaultAccount: (...args: [unknown, string, string]) => mockLend(...args) }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 't' }, me: { user: { id: 'u1' }, workspace: { id: 7 } } }) }))
jest.mock('use-intl', () => ({ useTranslations: () => (key: string) => key }))

const ALICE = { id: 'a', slug: 'gmail', label: 'alice@acme.com' }
const SLACK = { id: 'b', slug: 'slack', label: 'Acme' }

describe('useVaultAccounts', () => {
    beforeEach(() => {
        mockRead.mockReset()
        mockLend.mockReset()
    })

    it("offers each app's accounts, then lends one and stops offering it", async () => {
        mockRead.mockResolvedValue({ canAttach: true, accounts: [ALICE, SLACK] })
        mockLend.mockResolvedValue()

        const { result } = await renderHook(() => useVaultAccounts('a1'))
        await settled()
        expect(result.current.accountsFor('gmail')).toEqual([ALICE])

        let lent = false
        await act(async () => {
            lent = await result.current.lend(ALICE)
        })
        expect(lent).toBe(true)
        expect(mockLend).toHaveBeenCalledWith({ accessToken: 't', workspaceId: 7 }, 'a1', 'a')
        expect(result.current.accountsFor('gmail')).toEqual([])
        expect(result.current.lending).toBeNull()
    })

    it("keeps the hub's refusal under the app it was for", async () => {
        mockRead.mockResolvedValue({ canAttach: true, accounts: [ALICE] })
        mockLend.mockRejectedValue(new Error("You don't manage this coworker's Box"))

        const { result } = await renderHook(() => useVaultAccounts('a1'))
        await settled()
        await act(async () => {
            await result.current.lend(ALICE)
        })
        expect(result.current.errorFor('gmail')).toBe("You don't manage this coworker's Box")
        expect(result.current.errorFor('slack')).toBeNull()
        expect(result.current.accountsFor('gmail')).toEqual([ALICE])
    })

    it('lends nothing when the caller cannot', async () => {
        mockRead.mockResolvedValue({ canAttach: false, accounts: [ALICE] })

        const { result } = await renderHook(() => useVaultAccounts('a1'))
        await settled()
        await act(async () => {
            expect(await result.current.lend(ALICE)).toBe(false)
        })
        expect(mockLend).not.toHaveBeenCalled()
    })

    it('offers nothing when the hub cannot be reached, and asks nothing until wanted', async () => {
        mockRead.mockRejectedValue(new Error('offline'))
        const { result } = await renderHook(() => useVaultAccounts('a1'))
        await settled()
        expect(result.current.accountsFor('gmail')).toEqual([])

        mockRead.mockClear()
        await renderHook(() => useVaultAccounts('a1', false))
        expect(mockRead).not.toHaveBeenCalled()
    })
})
