import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkVerification, sendVerification } from './bird-verify'

const fetchMock = vi.fn()

const answers = (status: number, body: object = {}, headers: Record<string, string> = {}) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status, headers }))

const answersInTurn = (...replies: [number, object][]) => {
    for (const [status, body] of replies) fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))
}

const lastCall = () => {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    return { url, headers: init.headers, body: JSON.parse(init.body as string) }
}

const urls = () => fetchMock.mock.calls.map(([url]) => url as string)

const birdError = (code: string, name?: string) => ({ error: { type: 'validation_error', code, name, message: 'Bird says no', request_id: 'req_test' } })

const PENDING = { status: 'pending', last_channel: 'sms' }

const NOW = Date.parse('2026-10-14T12:00:00Z')
const secondsAgo = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()

beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('BIRD_API_KEY', 'bk_eu1_test')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('sendVerification', () => {
    it('posts to the region the key names, with the other channel behind the WhatsApp the visitor picked', async () => {
        answers(201, { status: 'pending', last_channel: 'whatsapp' })

        expect(await sendVerification('+32492000000', 'whatsapp', { metadata: { context: 'wall', user_id: 'user-1' } })).toEqual({ ok: true, channel: 'whatsapp' })

        expect(lastCall()).toEqual({
            url: 'https://eu1.platform.bird.com/v1/verify/verifications',
            headers: { Authorization: 'Bearer bk_eu1_test', 'Content-Type': 'application/json' },
            body: {
                to: { phone_number: '+32492000000' },
                options: { channels: ['whatsapp', 'sms'], code_length: 6 },
                metadata: { context: 'wall', user_id: 'user-1' },
            },
        })
    })

    it('starts a code asked by SMS on SMS, with WhatsApp behind it', async () => {
        answers(201, PENDING)

        expect(await sendVerification('+32492000000', 'sms')).toEqual({ ok: true, channel: 'sms' })

        expect(lastCall().body.options.channels).toEqual(['sms', 'whatsapp'])
    })

    it('says where Bird sent the code, which is not always where it was asked', async () => {
        answers(200, { status: 'pending', last_channel: 'whatsapp' })

        expect(await sendVerification('+32492000000', 'sms')).toEqual({ ok: true, channel: 'whatsapp' })
    })

    it('asks for the language of the visitor, and leaves it to Bird without one', async () => {
        answers(201, PENDING)

        await sendVerification('+32492000000', 'sms', { language: 'fr-BE' })
        expect(lastCall().body.options.language).toBe('fr-BE')

        await sendVerification('+32492000000', 'sms', { language: null })
        expect(lastCall().body.options).not.toHaveProperty('language')
    })

    it('leaves WhatsApp out of the plan where Bird Verify cannot carry a code by it', async () => {
        answers(201, PENDING)

        expect(await sendVerification('+919876543210', 'whatsapp')).toEqual({ ok: true, channel: 'sms' })

        expect(lastCall().body.options.channels).toEqual(['sms'])
    })

    it('does not move a verification to a channel the country cannot get', async () => {
        answers(201, PENDING)

        expect(await sendVerification('+919876543210', 'whatsapp', { previousChannel: 'sms' })).toEqual({ ok: true, channel: 'sms' })

        expect(urls()).toEqual(['https://eu1.platform.bird.com/v1/verify/verifications'])
    })

    it('sends no SMS code to Saudi Arabia, where none is ever delivered', async () => {
        expect(await sendVerification('+966501234567', 'sms')).toEqual({ ok: false, error: 'unsupported_country' })

        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('sends nothing to a country no channel reaches', async () => {
        expect(await sendVerification('+8613812345678', 'sms')).toEqual({ ok: false, error: 'unsupported_country' })

        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('moves the verification in progress to the other channel instead of asking for it again', async () => {
        answers(200, { status: 'pending', last_channel: 'sms' })

        expect(await sendVerification('+32492000000', 'sms', { previousChannel: 'whatsapp' })).toEqual({ ok: true, channel: 'sms' })

        expect(urls()).toEqual(['https://eu1.platform.bird.com/v1/verify/verifications/next-channel'])
        expect(lastCall().body).toEqual({ to: { phone_number: '+32492000000' } })
    })

    it('asks again when there is no verification left to move, or nowhere left to move it', async () => {
        vi.useFakeTimers({ now: NOW })
        answersInTurn([404, birdError('E13000')], [201, PENDING])
        expect(await sendVerification('+32492000000', 'sms', { previousChannel: 'whatsapp' })).toEqual({ ok: true, channel: 'sms' })
        expect(urls().at(-1)).toBe('https://eu1.platform.bird.com/v1/verify/verifications')

        answersInTurn([422, birdError('E13020', 'NoNextChannel')], [200, { status: 'pending', last_channel: 'sms' }])
        expect(await sendVerification('+32492000000', 'whatsapp', { previousChannel: 'sms', lastSentAt: secondsAgo(70) })).toEqual({ ok: true, channel: 'sms' })
        expect(urls().at(-1)).toBe('https://eu1.platform.bird.com/v1/verify/verifications')
    })

    it('holds a switch with nowhere to go while Bird would hold the resend, the channel asked for being the one Bird is on', async () => {
        vi.useFakeTimers({ now: NOW })
        answersInTurn([422, birdError('E13020', 'NoNextChannel')], [200, { status: 'pending', last_channel: 'whatsapp', channels: [{ channel: 'sms' }, { channel: 'whatsapp' }] }])

        expect(await sendVerification('+32492000000', 'whatsapp', { previousChannel: 'sms', lastSentAt: secondsAgo(30) })).toEqual({ ok: false, error: 'too_soon', retryAfterSeconds: 30 })

        expect(urls()).toEqual(['https://eu1.platform.bird.com/v1/verify/verifications/next-channel', 'https://eu1.platform.bird.com/v1/verify/verifications'])
    })

    it('holds an SMS asked for after Bird already fell back from WhatsApp to SMS by itself', async () => {
        vi.useFakeTimers({ now: NOW })
        answersInTurn([422, birdError('E13020', 'NoNextChannel')], [200, { status: 'pending', last_channel: 'sms', channels: [{ channel: 'whatsapp' }, { channel: 'sms' }] }])

        expect(await sendVerification('+33640000000', 'sms', { previousChannel: 'whatsapp', lastSentAt: secondsAgo(23) })).toEqual({ ok: false, error: 'too_soon', retryAfterSeconds: 37 })

        expect(urls()).toEqual(['https://eu1.platform.bird.com/v1/verify/verifications/next-channel', 'https://eu1.platform.bird.com/v1/verify/verifications'])
    })

    it('refuses a switch to a channel the country leaves out of the plan, instead of saying a code is on its way', async () => {
        vi.useFakeTimers({ now: NOW })
        answersInTurn([422, birdError('E13020', 'NoNextChannel')], [200, { status: 'pending', last_channel: 'whatsapp', channels: [{ channel: 'whatsapp' }] }])

        expect(await sendVerification('+639171234567', 'sms', { previousChannel: 'whatsapp', lastSentAt: secondsAgo(27) })).toEqual({ ok: false, error: 'channel_unavailable' })

        expect(urls()).toEqual(['https://eu1.platform.bird.com/v1/verify/verifications/next-channel', 'https://eu1.platform.bird.com/v1/verify/verifications'])
    })

    it('says where the code went when that switch comes past the resend wait, Bird having resent on its own channel', async () => {
        vi.useFakeTimers({ now: NOW })
        answersInTurn([422, birdError('E13020', 'NoNextChannel')], [200, { status: 'pending', last_channel: 'whatsapp', channels: [{ channel: 'whatsapp' }] }])

        expect(await sendVerification('+639171234567', 'sms', { previousChannel: 'whatsapp', lastSentAt: secondsAgo(70) })).toEqual({ ok: true, channel: 'whatsapp' })

        expect(urls()).toEqual(['https://eu1.platform.bird.com/v1/verify/verifications/next-channel', 'https://eu1.platform.bird.com/v1/verify/verifications'])
    })

    it('does not move anything for a code asked again on the same channel', async () => {
        answers(200, PENDING)

        await sendVerification('+32492000000', 'sms', { previousChannel: 'sms' })

        expect(urls()).toEqual(['https://eu1.platform.bird.com/v1/verify/verifications'])
    })

    it('says no channel is left when every remaining one failed', async () => {
        answers(422, birdError('E13017', 'NoAvailableChannel'))

        expect(await sendVerification('+32492000000', 'sms', { previousChannel: 'whatsapp' })).toEqual({ ok: false, error: 'undeliverable' })
    })

    it('reads a verification Bird accepted but already stopped as a failure', async () => {
        answers(200, { status: 'blocked', reason: 'fraud' })
        expect(await sendVerification('+32492000000', 'sms')).toEqual({ ok: false, error: 'blocked' })

        answers(200, { status: 'failed', reason: 'undeliverable' })
        expect(await sendVerification('+32492000000', 'sms')).toEqual({ ok: false, error: 'undeliverable' })
    })

    it('names what went wrong', async () => {
        answers(422, birdError('E13001', 'InvalidRecipient'))
        expect(await sendVerification('+32492000000', 'sms')).toEqual({ ok: false, error: 'invalid_number' })

        answers(422, birdError('E13017', 'NoAvailableChannel'))
        expect(await sendVerification('+32492000000', 'sms')).toEqual({ ok: false, error: 'unsupported_country' })

        answers(422, birdError('E01001', 'ValidationError'))
        expect(await sendVerification('+32492000000', 'sms')).toEqual({ ok: false, error: 'unavailable' })

        answers(429, birdError('E13002'), { 'Retry-After': '1800' })
        expect(await sendVerification('+32492000000', 'sms')).toEqual({ ok: false, error: 'rate_limited', retryAfterSeconds: 1800 })

        answers(402, birdError('WalletInsufficientBalance'))
        expect(await sendVerification('+32492000000', 'sms')).toEqual({ ok: false, error: 'unavailable' })

        fetchMock.mockRejectedValue(new Error('network down'))
        expect(await sendVerification('+32492000000', 'sms')).toEqual({ ok: false, error: 'unavailable' })
    })

    it('reads the code inside the error envelope only, as Bird sends it', async () => {
        answers(422, { code: 'E13001', name: 'InvalidRecipient' })

        expect(await sendVerification('+32492000000', 'sms')).toEqual({ ok: false, error: 'unavailable' })
    })
})

describe('checkVerification', () => {
    it('passes the right code', async () => {
        answers(200, { success: true, reason: null })

        expect(await checkVerification('+32492000000', '123456')).toEqual({ ok: true })

        expect(lastCall()).toMatchObject({
            url: 'https://eu1.platform.bird.com/v1/verify/verifications/check',
            body: { to: { phone_number: '+32492000000' }, code: '123456' },
        })
    })

    it('tells a wrong code from a verification that is over', async () => {
        answers(200, { success: false, reason: 'incorrect_code' })
        expect(await checkVerification('+32492000000', '000000')).toEqual({ ok: false, error: 'wrong_code' })

        answers(200, { success: false, reason: 'expired' })
        expect(await checkVerification('+32492000000', '123456')).toEqual({ ok: false, error: 'expired' })

        answers(200, { success: false, reason: 'attempts_exhausted' })
        expect(await checkVerification('+32492000000', '123456')).toEqual({ ok: false, error: 'expired' })

        answers(404)
        expect(await checkVerification('+32492000000', '123456')).toEqual({ ok: false, error: 'expired' })
    })

    it('names what went wrong', async () => {
        answers(429)
        expect(await checkVerification('+32492000000', '123456')).toEqual({ ok: false, error: 'rate_limited' })

        answers(500)
        expect(await checkVerification('+32492000000', '123456')).toEqual({ ok: false, error: 'unavailable' })
    })
})

describe('without a Bird key', () => {
    beforeEach(() => vi.stubEnv('BIRD_API_KEY', ''))

    it('sends nothing outside production, where only the local code passes', async () => {
        vi.stubEnv('NODE_ENV', 'test')

        expect(await sendVerification('+32492000000', 'sms')).toEqual({ ok: true, channel: 'sms' })
        expect(await checkVerification('+32492000000', '000000')).toEqual({ ok: true })
        expect(await checkVerification('+32492000000', '123456')).toEqual({ ok: false, error: 'wrong_code' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('is unavailable in production', async () => {
        vi.stubEnv('NODE_ENV', 'production')

        expect(await sendVerification('+32492000000', 'sms')).toEqual({ ok: false, error: 'unavailable' })
        expect(await checkVerification('+32492000000', '000000')).toEqual({ ok: false, error: 'unavailable' })
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
