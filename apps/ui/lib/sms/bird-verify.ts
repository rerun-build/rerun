// Deliberately no 'server-only' import, for the same reason as lib/email/client.ts: a Trigger.dev
// task that pulls this in is bundled outside the Next.js RSC pipeline.

import { birdConfig, type BirdConfig } from '@/lib/bird/config'
import { countryOfE164 } from '@/lib/phone/normalize'
import { reachableChannels } from '@/lib/phone/reach'
import { isVerificationChannel, VERIFICATION_CODE_LENGTH, type VerificationChannel } from '@/lib/phone/verification'

// `channel_unavailable`: the channel asked for is not in the plan Bird keeps for the number's country.
export type VerificationFailure = 'invalid_number' | 'unsupported_country' | 'undeliverable' | 'blocked' | 'rate_limited' | 'too_soon' | 'channel_unavailable' | 'wrong_code' | 'expired' | 'unavailable'
export type VerificationRefusal = { ok: false; error: VerificationFailure; retryAfterSeconds?: number }
export type VerificationResult = { ok: true } | VerificationRefusal
// `channel` is where Bird says the code went, which is not always where it was asked to go.
export type VerificationSendResult = { ok: true; channel: VerificationChannel } | VerificationRefusal

// What the webhook needs to put a delivery event on the right person.
export type VerificationMetadata = { context: string; user_id?: string }

export type VerificationSendOptions = {
    language?: string | null
    // The channel the last code to this number went by, when there is one still in progress.
    previousChannel?: VerificationChannel | null
    // When that last code left, as the ledger has it.
    lastSentAt?: string | null
    metadata?: VerificationMetadata
}

// The code that passes where no SMS can leave: a local stack without a Bird key.
const LOCAL_CODE = '0'.repeat(VERIFICATION_CODE_LENGTH)

// The workspace's Retry Delay (Verify > Configure): asked again within it, Bird answers with the
// verification in progress and sends nothing, a 2xx like any other.
export const BIRD_RESEND_COOLDOWN_MS = 60_000

// Every channel that reaches the number's country, the picked one first: Bird keeps the plan of a
// verification in progress for every later send to the number, so a channel left out can never be
// reached again. A picked channel that cannot reach the country gives way to the next one.
function deliveryPlan(to: string, channel: VerificationChannel): VerificationChannel[] {
    const reachable = reachableChannels(countryOfE164(to), 'verify')
    return reachable.includes(channel) ? [channel, ...reachable.filter(other => other !== channel)] : reachable
}

// Bird's own error codes (https://bird.com/docs/api/errors/E13xxx).
const NOT_FOUND = 'E13000'
const INVALID_RECIPIENT = 'E13001'
const NO_AVAILABLE_CHANNEL = 'E13017'
const NO_NEXT_CHANNEL = 'E13020'

// Bird answers every error inside an envelope (https://bird.com/docs/api/errors), never at the top level.
type BirdError = { code?: string; name?: string; type?: string; message?: string; request_id?: string }

type BirdBody = {
    success?: boolean
    reason?: string | null
    status?: string
    last_channel?: string | null
    // The plan Bird resolved for the number: the channels asked for that its country allows, in order.
    channels?: { channel?: string }[]
    error?: BirdError
}

type BirdAnswer = { status: number; body: BirdBody; retryAfterSeconds?: number }

const errorCode = (answer: BirdAnswer) => answer.body.error?.code

// An answer without its plan leaves the channel possible: nothing says Bird dropped it.
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
    // A country switched off under Verify > Countries leaves the number no channel at all.
    if (resource === 'send' && errorCode(answer) === NO_AVAILABLE_CHANNEL) return { ok: false, error: 'unsupported_country' }
    return { ok: false, error: 'unavailable' }
}

// A 2xx only says Bird took the request: the verification it answers with can already be stopped.
function sendOutcome(answer: BirdAnswer, channel: VerificationChannel): VerificationSendResult {
    if (answer.status >= 300) return failure('send', answer)
    const { status, reason, last_channel } = answer.body
    if (status === 'blocked' || status === 'failed') {
        console.error('[bird-verify] send stopped', status, reason, last_channel)
        return { ok: false, error: status === 'blocked' ? 'blocked' : 'undeliverable' }
    }
    return { ok: true, channel: isVerificationChannel(last_channel) ? last_channel : channel }
}

// Asking again for a number with a verification in progress reuses it, plan and all, so a code
// asked for on the other channel has to move the verification along its plan. Nothing moves when
// there is no verification in progress, or when it is already on its last channel.
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

// How long Bird would still hold a resend on the verification in progress, once nothing is left to
// switch to. Null once it would send.
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
        // Left to itself Bird tries WhatsApp before SMS in most countries: the plan starts on the
        // channel the visitor picked. Meta turns a WhatsApp code away after Bird has accepted it,
        // so SMS follows it in the plan and Bird moves on by itself, but only where the country's
        // Verify settings allow SMS: Bird drops from the plan any channel they leave out.
        const answer = await post(config, '', {
            to: { phone_number: to },
            options: { channels: plan, code_length: VERIFICATION_CODE_LENGTH, ...(language ? { language } : {}) },
            ...(metadata ? { metadata } : {}),
        })
        const outcome = sendOutcome(answer, channel)
        if (!outcome.ok || !nowhereToMove) return outcome
        // Nowhere to move means Bird is already on the channel asked for, or never had it. Past its
        // resend wait Bird has just sent a fresh code on its own channel, and `outcome` says where.
        // Within it Bird sends nothing and answers with the verification in progress.
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
        // Bird forgets a verification once it is verified, expired or out of attempts, and answers
        // a check on it with a 404.
        if (answer.status === 404) return { ok: false, error: 'expired' }
        if (answer.status >= 300) return failure('check', answer)
        if (answer.body.success) return { ok: true }
        return { ok: false, error: answer.body.reason === 'incorrect_code' ? 'wrong_code' : 'expired' }
    } catch (error) {
        console.error('[bird-verify] check failed', error)
        return { ok: false, error: 'unavailable' }
    }
}
