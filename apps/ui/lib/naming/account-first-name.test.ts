import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAuthUser = vi.fn()
vi.mock('@/supabase/session/getServerSession', () => ({ getAuthUser: () => getAuthUser() }))

const { accountFirstName } = await import('./account-first-name')

describe('accountFirstName', () => {
    beforeEach(() => {
        getAuthUser.mockReset()
    })

    it('takes the first name the token carries without asking the auth server', async () => {
        await expect(accountFirstName({ user_metadata: { first_name: 'Ada' } })).resolves.toBe('Ada')
        expect(getAuthUser).not.toHaveBeenCalled()
    })

    it('asks the auth server when the token was issued before the first name was given', async () => {
        getAuthUser.mockResolvedValue({ user_metadata: { first_name: 'Ada', full_name: 'Ada' } })

        await expect(accountFirstName({ user_metadata: {} })).resolves.toBe('Ada')
        expect(getAuthUser).toHaveBeenCalledOnce()
    })

    it('answers nothing for an account that has no first name anywhere', async () => {
        getAuthUser.mockResolvedValue({ user_metadata: {} })

        await expect(accountFirstName({ user_metadata: {} })).resolves.toBe('')
    })

    it('asks nobody when there is no session to ask for', async () => {
        await expect(accountFirstName(null)).resolves.toBe('')
        expect(getAuthUser).not.toHaveBeenCalled()
    })
})
