import { ApiError } from '@/api/client'
import { sendEmailCode, sendPhoneCode, signInWithPhone, SignInError } from '@/auth/sign-in'

const mockApi = jest.fn()
jest.mock('@/api/client', () => {
    const actual = jest.requireActual('@/api/client')
    return { ...actual, hub: actual.createHubClient((...args: unknown[]) => mockApi(...args)) }
})
const mockSetSession = jest.fn()
const mockSignInWithOtp = jest.fn()
jest.mock('@/auth/supabase', () => ({ supabase: { auth: { setSession: (...args: unknown[]) => mockSetSession(...args), signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args) } } }))

const REQUEST = { phone: '06 12 34 56 78', country: 'FR', channel: 'whatsapp' as const }

describe('sign-in calls', () => {
    beforeEach(() => {
        mockApi.mockReset()
        mockSetSession.mockReset()
        mockSignInWithOtp.mockReset()
        mockSetSession.mockResolvedValue({ error: null })
        mockSignInWithOtp.mockResolvedValue({ error: null })
    })

    it('returns the channel the code really went by', async () => {
        mockApi.mockResolvedValue({ channel: 'sms' })
        expect(await sendPhoneCode(REQUEST)).toBe('sms')
        expect(mockApi).toHaveBeenCalledWith('/api/v1/auth/phone/code', { method: 'POST', body: REQUEST })
    })

    it('shows the message of a refusal and keeps its wait', async () => {
        mockApi.mockRejectedValue(new ApiError(429, 'A code is already on its way.', { error: 'A code is already on its way.', reason: 'too_soon', retryAfterSeconds: 42 }))
        await expect(sendPhoneCode(REQUEST)).rejects.toMatchObject({ message: 'A code is already on its way.', reason: 'too_soon', retryAfterSeconds: 42 })
    })

    it('reads a failure without a refusal body as a connection problem', async () => {
        mockApi.mockRejectedValue(new TypeError('Network request failed'))
        await expect(sendPhoneCode(REQUEST)).rejects.toBeInstanceOf(SignInError)
        await expect(sendPhoneCode(REQUEST)).rejects.toMatchObject({ reason: 'network' })
    })

    it('opens the session the hub handed back', async () => {
        mockApi.mockResolvedValue({ created: true, session: { accessToken: 'access', refreshToken: 'refresh' } })
        expect(await signInWithPhone(REQUEST, '123456')).toBe(true)
        expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'access', refresh_token: 'refresh' })
    })

    it('asks Supabase for a code only when the hub did not mail one', async () => {
        mockApi.mockResolvedValue({ mailed: true })
        await sendEmailCode('ada@example.com')
        expect(mockSignInWithOtp).not.toHaveBeenCalled()

        mockApi.mockResolvedValue({ mailed: false })
        await sendEmailCode('ada@example.com')
        expect(mockSignInWithOtp).toHaveBeenCalledWith({ email: 'ada@example.com', options: { shouldCreateUser: false } })
    })
})
