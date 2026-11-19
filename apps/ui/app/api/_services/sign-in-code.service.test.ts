import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendSignInCodeEmail = vi.fn()
vi.mock('@moldwright/cloud/email', () => ({ sendSignInCodeEmail: (input: unknown) => sendSignInCodeEmail(input) }))

const selectMaybeSingle = vi.fn()
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: (...args: unknown[]) => selectMaybeSingle(...args) }))

const upsert = vi.fn()
const update = vi.fn()
const deleteEq = vi.fn()
const deleteLt = vi.fn()
const getUserById = vi.fn()
vi.mock('@/supabase/serviceRole', () => ({
    createServiceRoleClient: () => ({
        from: () => ({
            upsert: (...args: unknown[]) => upsert(...args),
            update: (payload: unknown) => ({ eq: async (_column: string, value: string) => update(payload, value) }),
            delete: () => ({ eq: async (_column: string, value: string) => deleteEq(value), lt: async (_column: string, value: string) => deleteLt(value) }),
        }),
        auth: { admin: { getUserById: (id: string) => getUserById(id) } },
    }),
}))

const NOW = Date.parse('2026-10-06T12:00:00Z')
const minutesFromNow = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()

const row = (overrides: object = {}) => ({
    email: 'a@b.co',
    user_id: 'user-1',
    type: 'magiclink',
    code: '123456',
    token_hash: 'hash1',
    issued_at: minutesFromNow(-3),
    expires_at: minutesFromNow(12),
    last_sent_at: minutesFromNow(-3),
    send_count: 1,
    ...overrides,
})

const user = (overrides: object = {}) => ({ id: 'user-1', email: 'a@b.co', recovery_sent_at: minutesFromNow(-3), last_sign_in_at: minutesFromNow(-600), ...overrides })

const stored = (value: object | null) => selectMaybeSingle.mockResolvedValue({ data: value, error: null })
const owner = (value: object | null) => getUserById.mockResolvedValue({ data: { user: value }, error: null })

describe('resendSignInCodeIfLive', () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: NOW })
        for (const mock of [sendSignInCodeEmail, selectMaybeSingle, upsert, update, deleteEq, deleteLt, getUserById]) mock.mockReset()
        sendSignInCodeEmail.mockResolvedValue({ ok: true, id: 'email_1' })
        owner(user())
    })

    it('mails the same code again while it is still good', async () => {
        stored(row())
        const { resendSignInCodeIfLive } = await import('./sign-in-code.service')

        expect(await resendSignInCodeIfLive('A@b.co ', null)).toBe('sent')

        const input = sendSignInCodeEmail.mock.calls[0][0]
        expect(input).toMatchObject({ to: 'a@b.co', code: '123456', expiresInMinutes: 12 })
        expect(input.signInUrl).toContain('/auth/confirm?token_hash=hash1&type=magiclink')
        expect(update).toHaveBeenCalledWith({ last_sent_at: new Date(NOW).toISOString(), send_count: 2 }, 'a@b.co')
    })

    it('asks for a new code when none is remembered', async () => {
        stored(null)
        const { resendSignInCodeIfLive } = await import('./sign-in-code.service')

        expect(await resendSignInCodeIfLive('a@b.co', null)).toBeNull()
        expect(sendSignInCodeEmail).not.toHaveBeenCalled()
    })

    it('asks for a new code when the remembered one is about to expire', async () => {
        stored(row({ expires_at: minutesFromNow(4) }))
        const { resendSignInCodeIfLive } = await import('./sign-in-code.service')

        expect(await resendSignInCodeIfLive('a@b.co', null)).toBeNull()
        expect(sendSignInCodeEmail).not.toHaveBeenCalled()
    })

    it('asks for a new code once the same one went out five times', async () => {
        stored(row({ send_count: 5 }))
        const { resendSignInCodeIfLive } = await import('./sign-in-code.service')

        expect(await resendSignInCodeIfLive('a@b.co', null)).toBeNull()
    })

    it('forgets a code the user already signed in with', async () => {
        stored(row())
        owner(user({ last_sign_in_at: minutesFromNow(-1) }))
        const { resendSignInCodeIfLive } = await import('./sign-in-code.service')

        expect(await resendSignInCodeIfLive('a@b.co', null)).toBeNull()
        expect(deleteEq).toHaveBeenCalledWith('a@b.co')
        expect(sendSignInCodeEmail).not.toHaveBeenCalled()
    })

    it('forgets a code that another one replaced outside the hook', async () => {
        stored(row())
        owner(user({ recovery_sent_at: minutesFromNow(-1) }))
        const { resendSignInCodeIfLive } = await import('./sign-in-code.service')

        expect(await resendSignInCodeIfLive('a@b.co', null)).toBeNull()
        expect(deleteEq).toHaveBeenCalledWith('a@b.co')
    })

    it('says the code left less than a minute ago, without mailing it twice', async () => {
        stored(row({ issued_at: minutesFromNow(-0.5), last_sent_at: minutesFromNow(-0.5) }))
        const { resendSignInCodeIfLive } = await import('./sign-in-code.service')

        expect(await resendSignInCodeIfLive('a@b.co', null)).toBe('held')
        expect(sendSignInCodeEmail).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
    })

    it('hands an email change code back only to the visitor who claimed the address', async () => {
        stored(row({ type: 'email_change' }))
        owner(user({ email: '', new_email: 'a@b.co', email_change_sent_at: minutesFromNow(-3), recovery_sent_at: undefined }))
        const { resendSignInCodeIfLive } = await import('./sign-in-code.service')

        expect(await resendSignInCodeIfLive('a@b.co', 'someone-else')).toBeNull()
        expect(await resendSignInCodeIfLive('a@b.co', null)).toBeNull()
        expect(sendSignInCodeEmail).not.toHaveBeenCalled()

        expect(await resendSignInCodeIfLive('a@b.co', 'user-1')).toBe('sent')
        expect(sendSignInCodeEmail.mock.calls[0][0].signInUrl).toContain('type=email_change')
    })

    it('mails an account moving to a new address its code again, without a sign-in link', async () => {
        stored(row({ type: 'email_change' }))
        owner(user({ email: 'old@b.co', new_email: 'a@b.co', email_change_sent_at: minutesFromNow(-3), recovery_sent_at: undefined }))
        const { resendSignInCodeIfLive } = await import('./sign-in-code.service')

        expect(await resendSignInCodeIfLive('a@b.co', 'user-1')).toBe('sent')
        expect(sendSignInCodeEmail.mock.calls[0][0].signInUrl).toBeUndefined()
    })

    it('asks for a new code when the email could not be sent again', async () => {
        stored(row())
        sendSignInCodeEmail.mockResolvedValue({ ok: false, error: 'boom' })
        const { resendSignInCodeIfLive } = await import('./sign-in-code.service')

        expect(await resendSignInCodeIfLive('a@b.co', null)).toBeNull()
        expect(update).not.toHaveBeenCalled()
    })
})

describe('rememberSignInCode', () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: NOW })
        for (const mock of [upsert, deleteLt]) mock.mockReset()
    })

    it('stores the code under its recipient for fifteen minutes and sweeps the expired ones', async () => {
        upsert.mockResolvedValue({ error: null })
        const { rememberSignInCode } = await import('./sign-in-code.service')

        await rememberSignInCode({ email: 'A@b.co', userId: 'user-1', type: 'magiclink', code: '123456', tokenHash: 'hash1' })

        expect(upsert).toHaveBeenCalledWith(
            { email: 'a@b.co', user_id: 'user-1', type: 'magiclink', code: '123456', token_hash: 'hash1', issued_at: minutesFromNow(0), expires_at: minutesFromNow(15), last_sent_at: minutesFromNow(0), send_count: 1 },
            { onConflict: 'email' },
        )
        expect(deleteLt).toHaveBeenCalledWith(minutesFromNow(0))
    })

    it('swallows a failed write', async () => {
        upsert.mockRejectedValue(new Error('relation "sign_in_codes" does not exist'))
        const { rememberSignInCode } = await import('./sign-in-code.service')

        await expect(rememberSignInCode({ email: 'a@b.co', userId: 'user-1', type: 'magiclink', code: '1', tokenHash: 'h' })).resolves.toBeUndefined()
    })
})
