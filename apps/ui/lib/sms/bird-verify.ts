import { birdConfig, type BirdConfig } from '@/lib/bird/config'
import { countryOfE164 } from '@/lib/phone/normalize'
import { reachableChannels } from '@/lib/phone/reach'
import { isVerificationChannel, VERIFICATION_CODE_LENGTH, type VerificationChannel } from '@/lib/phone/verification'

export type VerificationFailure = 'invalid_number' | 'unsupported_country' | 'undeliverable' | 'blocked' | 'rate_limited' | 'too_soon' | 'channel_unavailable' | 'wrong_code' | 'expired' | 'unavailable'
export type VerificationRefusal = { ok: false; error: VerificationFailure; retryAfterSeconds?: number }
export type VerificationResult = { ok: true } | VerificationRefusal
export type VerificationSendResult = { ok: true; channel: VerificationChannel } | VerificationRefusal

export type VerificationMetadata = { context: string; user_id?: string }

export type VerificationSendOptions = {
    language?: string | null
    previousChannel?: VerificationChannel | null
    lastSentAt?: string | null
    metadata?: VerificationMetadata
}

const LOCAL_CODE = '0'.repeat(VERIFICATION_CODE_LENGTH)

export const BIRD_RESEND_COOLDOWN_MS = 60_000

function deliveryPlan(to: string, channel: VerificationChannel): VerificationChannel[] {
    const reachable = reachableChannels(countryOfE164(to), 'verify')
    return reachable.includes(channel) ? [channel, ...reachable.filter(other => other !== channel)] : reachable
}

const NOT_FOUND = 'E13000'
const INVALID_RECIPIENT = 'E13001'
const NO_AVAILABLE_CHANNEL = 'E13017'
const NO_NEXT_CHANNEL = 'E13020'

type BirdError = { code?: string; name?: string; type?: string; message?: string; request_id?: string }

type BirdBody = {
    success?: boolean
    reason?: string | null
    status?: string
    last_channel?: string | null
    channels?: { channel?: string }[]
    error?: BirdError
}

type BirdAnswer = { status: number; body: BirdBody; retryAfterSeconds?: number }

const errorCode = (answer: BirdAnswer) => answer.body.error?.code

const planLeavesOut = (answer: BirdAnswer, channel: VerificationChannel) => !!answer.body.channels && !answer.body.channels.some(entry => entry.channel === channel)

const sendsNothing = () => process.env.NODE_ENV !== 'production'

function retryAfter(response: Response): number | undefined {
    const seconds = Number(response.headers.get('retry-after'))
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined
}

async function post(config: BirdConfig, path: '' | '/check' | '/next-channel', payload: object): Promise<BirdAnswer> {
    const response = await fetch(`${config.baseUrl}/verify/verifications${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
    const body = (await response.json().catch(() => ({}))) as BirdBody
    return { status: response.status, body, retryAfterSeconds: retryAfter(response) }
}

function failure(resource: 'send' | 'check', answer: BirdAnswer): VerificationRefusal {
    const { status, body, retryAfterSeconds } = answer
    if (status === 429) return { ok: false, error: 'rate_limited', ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }
    console.error(`[bird-verify] ${resource} failed`, status, body.error?.code, body.error?.name ?? body.error?.type, body.error?.message, body.error?.request_id)
    if (resource === 'send' && errorCode(answer) === INVALID_RECIPIENT) return { ok: false, error: 'invalid_number' }
    if (resource === 'send' && errorCode(answer) === NO_AVAILABLE_CHANNEL) return { ok: false, error: 'unsupported_country' }
    return { ok: false, error: 'unavailable' }
}

function sendOutcome(answer: BirdAnswer, channel: VerificationChannel): VerificationSendResult {
    if (answer.status >= 300) return failure('send', answer)
    const { status, reason, last_channel } = answer.body
    if (status === 'blocked' || status === 'failed') {
        console.error('[bird-verify] send stopped', status, reason, last_channel)
        return { ok: false, error: status === 'blocked' ? 'blocked' : 'undeliverable' }
    }
    return { ok: true, channel: isVerificationChannel(last_channel) ? last_channel : channel }
}

async function switchChannel(config: BirdConfig, to: string, channel: VerificationChannel): Promise<VerificationSendResult | 'no_verification' | 'no_next_channel'> {
    const answer = await post(config, '/next-channel', { to: { phone_number: to } })
    if (answer.status === 404 && (errorCode(answer) ?? NOT_FOUND) === NOT_FOUND) return 'no_verification'
    if (answer.status === 422 && errorCode(answer) === NO_NEXT_CHANNEL) return 'no_next_channel'
    if (answer.status === 422 && errorCode(answer) === NO_AVAILABLE_CHANNEL) {
        console.error('[bird-verify] no channel left', answer.body.error?.message, answer.body.error?.request_id)
        return { ok: false, error: 'undeliverable' }
    }
    return sendOutcome(answer, channel)
}

function resendHeldFor(lastSentAt: string | null): number | null {
    if (!lastSentAt) return null
    const resendAt = Date.parse(lastSentAt) + BIRD_RESEND_COOLDOWN_MS
    const now = Date.now()
    return now < resendAt ? Math.max(1, Math.ceil((resendAt - now) / 1000)) : null
}

export async function sendVerification(to: string, picked: VerificationChannel, { language = null, previousChannel = null, lastSentAt = null, metadata }: VerificationSendOptions = {}): Promise<VerificationSendResult> {
    const plan = deliveryPlan(to, picked)
    const [channel] = plan
    if (!channel) return { ok: false, error: 'unsupported_country' }
    const config = birdConfig()
    if (!config) {
        if (!sendsNothing()) return { ok: false, error: 'unavailable' }
        console.info(`[bird-verify] no Bird key, nothing sent to ${to} by ${channel}: the code is ${LOCAL_CODE}`)
        return { ok: true, channel }
    }
    try {
        let nowhereToMove = false
        if (previousChannel && previousChannel !== channel) {
            const switched = await switchChannel(config, to, channel)
            if (typeof switched === 'object') return switched
            nowhereToMove = switched === 'no_next_channel'
        }
        const answer = await post(config, '', {
            to: { phone_number: to },
            options: { channels: plan, code_length: VERIFICATION_CODE_LENGTH, ...(language ? { language } : {}) },
            ...(metadata ? { metadata } : {}),
        })
        const outcome = sendOutcome(answer, channel)
        if (!outcome.ok || !nowhereToMove) return outcome
        const retryAfterSeconds = resendHeldFor(lastSentAt)
        if (!retryAfterSeconds) return outcome
        return planLeavesOut(answer, channel) ? { ok: false, error: 'channel_unavailable' } : { ok: false, error: 'too_soon', retryAfterSeconds }
    } catch (error) {
        console.error('[bird-verify] send failed', error)
        return { ok: false, error: 'unavailable' }
    }
}

export async function checkVerification(to: string, code: string): Promise<VerificationResult> {
    const config = birdConfig()
    if (!config) {
        if (!sendsNothing()) return { ok: false, error: 'unavailable' }
        return code === LOCAL_CODE ? { ok: true } : { ok: false, error: 'wrong_code' }
    }
    try {
        const answer = await post(config, '/check', { to: { phone_number: to }, code })
        if (answer.status === 404) return { ok: false, error: 'expired' }
        if (answer.status >= 300) return failure('check', answer)
        if (answer.body.success) return { ok: true }
        return { ok: false, error: answer.body.reason === 'incorrect_code' ? 'wrong_code' : 'expired' }
    } catch (error) {
        console.error('[bird-verify] check failed', error)
        return { ok: false, error: 'unavailable' }
    }
}
