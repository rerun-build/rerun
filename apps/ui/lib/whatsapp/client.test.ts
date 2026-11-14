import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendWhatsAppTemplate, whatsappDestination, type SendWhatsAppInput } from './client'

const senders = vi.hoisted(() => ({ DEFAULT_WHATSAPP_FROM: '+15550100000' as string | null }))
vi.mock('@rerun/cloud/senders', () => senders)

const fetchMock = vi.fn()

const answers = (status: number, body: object = {}) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }))

const lastCall = () => {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    return { url, headers: init.headers, body: JSON.parse(init.body as string) }
}

const COMPONENTS: SendWhatsAppInput['components'] = [{ type: 'button', parameters: [{ type: 'text', text: 'w/acme' }] }]

function input(overrides: Partial<SendWhatsAppInput> = {}): SendWhatsAppInput {
    return { to: '+32492000000', slug: 'rerun_access_ends_help', language: 'fr', components: COMPONENTS, idempotencyKey: 'whatsapp:row-1', ...overrides }
}

beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('BIRD_API_KEY', 'bk_eu1_test')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('EMAIL_REDIRECT_TO', '')
    vi.stubEnv('WHATSAPP_REDIRECT_TO', '')
    vi.stubEnv('BIRD_WHATSAPP_FROM', '')
    senders.DEFAULT_WHATSAPP_FROM = '+15550100000'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('whatsappDestination', () => {
    it('writes to the real number in production', () => {
        expect(whatsappDestination('+32492000000')).toBe('+32492000000')
    })

    it('sends everything to the redirect number when one is set', () => {
        vi.stubEnv('WHATSAPP_REDIRECT_TO', '+352691000000')
        vi.stubEnv('EMAIL_REDIRECT_TO', 'staging@rerun.build')

        expect(whatsappDestination('+32492000000')).toBe('+352691000000')
    })

    it('sends nothing from a clone of production that has no redirect number', () => {
        vi.stubEnv('EMAIL_REDIRECT_TO', 'staging@rerun.build')

        expect(whatsappDestination('+32492000000')).toBeNull()
    })

    it('sends nothing from a local stack', () => {
        vi.stubEnv('NODE_ENV', 'development')

        expect(whatsappDestination('+32492000000')).toBeNull()
    })
})

describe('sendWhatsAppTemplate', () => {
    it('posts the template to the region the key names, from our number, under its idempotency key', async () => {
        answers(202, { id: 'wam_1', status: 'accepted' })

        expect(await sendWhatsAppTemplate(input({ tags: [{ name: 'template', value: 'access_ends_help' }], metadata: { message_id: 'row-1' } }))).toEqual({ ok: true, id: 'wam_1' })

        expect(lastCall()).toEqual({
            url: 'https://eu1.platform.bird.com/v1/whatsapp/messages',
            headers: { Authorization: 'Bearer bk_eu1_test', 'Content-Type': 'application/json', 'Idempotency-Key': 'whatsapp:row-1' },
            body: {
                to: '+32492000000',
                from: '+15550100000',
                template: { slug: 'rerun_access_ends_help', language: 'fr', components: COMPONENTS },
                tags: [{ name: 'template', value: 'access_ends_help' }],
                metadata: { message_id: 'row-1' },
            },
        })
    })

    it('sends from BIRD_WHATSAPP_FROM over the default sender', async () => {
        vi.stubEnv('BIRD_WHATSAPP_FROM', '+15550100001')
        answers(202, { id: 'wam_1' })

        await sendWhatsAppTemplate(input())

        expect(lastCall().body.from).toBe('+15550100001')
    })

    it('sends nothing without a sender number', async () => {
        senders.DEFAULT_WHATSAPP_FROM = null

        expect(await sendWhatsAppTemplate(input())).toEqual({ ok: false, error: 'unavailable', detail: 'BIRD_WHATSAPP_FROM is not set' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('leaves tags and metadata out when there are none', async () => {
        answers(202, { id: 'wam_1' })

        await sendWhatsAppTemplate(input())

        expect(lastCall().body).not.toHaveProperty('tags')
        expect(lastCall().body).not.toHaveProperty('metadata')
    })

    it('writes to the redirect number instead of the recipient', async () => {
        vi.stubEnv('WHATSAPP_REDIRECT_TO', '+352691000000')
        answers(202, { id: 'wam_1' })

        await sendWhatsAppTemplate(input())

        expect(lastCall().body.to).toBe('+352691000000')
    })

    it('skips the send where delivery is off', async () => {
        vi.stubEnv('NODE_ENV', 'development')

        expect(await sendWhatsAppTemplate(input())).toEqual({ ok: true, id: null, skipped: true })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('fails without a key rather than pretending to send', async () => {
        vi.stubEnv('BIRD_API_KEY', '')

        expect(await sendWhatsAppTemplate(input())).toEqual({ ok: false, error: 'unavailable', detail: 'BIRD_API_KEY is not set' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each([
        [429, 'rate_limited'],
        [422, 'rejected'],
        [503, 'unavailable'],
    ])('reads a %i as %s', async (status, error) => {
        answers(status, { error: { type: 'validation_error', code: 'E15023', message: 'Sender mismatch', request_id: 'req_test' } })

        expect(await sendWhatsAppTemplate(input())).toEqual({ ok: false, error, detail: `${status} E15023 Sender mismatch req_test` })
    })

    it('reads a request that never answered as unavailable', async () => {
        fetchMock.mockRejectedValue(new Error('socket hang up'))

        expect(await sendWhatsAppTemplate(input())).toEqual({ ok: false, error: 'unavailable', detail: 'socket hang up' })
    })
})
