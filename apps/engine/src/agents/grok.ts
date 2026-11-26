import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelMiddleware, wrapLanguageModel } from 'ai'
import { GROK_MODEL_NOT_IN_PLAN, GROK_NO_SUBSCRIPTION, GROK_PROXY_BASE_URL, GROK_WEEKLY_LIMIT, grokSeesImages, type PlanLimitWindow } from '@rerun/contracts'

// What a refusal of the allowance reads when the week's reading cannot tell which one it is: still a
// spent subscription to the chat, which then names no window it cannot vouch for.
const GROK_ALLOWANCE_REFUSED = 'Grok usage limit reached'
import { recordCredentialRejected } from '../connections/credential-rejections.js'
import { refreshGrokPlanLimits } from '../connections/grok-plan-limits.js'
import { grokFetch, type GrokRequestContext } from '../connections/grok-proxy.js'
import { spentPlanWindow } from '../connections/plan-limits.js'
import type { LoadedConnection } from '../connections/types.js'
import { refusalMessageOf, refusalResponse } from '../lib/refusal-body.js'

type FetchFunction = typeof globalThis.fetch
type LanguageModelV3 = Parameters<typeof wrapLanguageModel>[0]['model']

// xAI's words for an allowance spent or never there, read by OpenClaw and Grok Build alike:
// "You have run out of credits or need a Grok subscription", "used all available credits".
const ALLOWANCE_REFUSAL = /used all available credits|run out of credits|monthly spending limit|purchase more credits|raise your spending limit|need a grok subscription/i
const NO_SUBSCRIPTION = /need a grok subscription/i
// "The model grok-9 does not exist or your team <id> does not have access to it."
const MODEL_REFUSAL = /does not exist or your team|does not have access to (?:it|this model)|model .* (?:is )?not available/i

const RESET_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' })

function weeklyLimit(window: PlanLimitWindow): string {
    return window.resetsAt ? `${GROK_WEEKLY_LIMIT} · resets ${RESET_FORMAT.format(new Date(window.resetsAt))}` : GROK_WEEKLY_LIMIT
}

type RefusalContext = { connection: LoadedConnection; model: string }

const ACCOUNT_READ_TIMEOUT_MS = 8000

// Asked of xAI when a refusal could mean the account has no plan: true only when it answers, in so
// many words, that the account has no access to Grok Build (`hasGrokCodeAccess: false`, read `true`
// on a GrokPro account on 2026-11-26). A read that fails or leaves the field out says nothing, and a
// subscriber is never told to go and subscribe. The token's own `tier` claim is a bare number (1 on
// that same account) and names no plan.
async function accountLacksGrokBuild(connection: LoadedConnection): Promise<boolean> {
    try {
        const response = await grokFetch({ connection, sessionId: `account-${connection.id}` })(`${GROK_PROXY_BASE_URL}/user`, { signal: AbortSignal.timeout(ACCOUNT_READ_TIMEOUT_MS) })
        if (!response.ok) {
            await response.body?.cancel()
            return false
        }
        const account = (await response.json()) as { hasGrokCodeAccess?: unknown } | null
        return account?.hasGrokCodeAccess === false
    } catch {
        return false
    }
}

/**
 * What a refusal is stored as, in the sentences the chat knows (`describeSubscriptionLimit`), or
 * null to keep the proxy's own sentence. xAI's own body is never kept for these: it names the
 * account's team. A spent allowance and an account without the plan answer with one sentence: the
 * week's reading, taken again now, says the first, xAI's own word on the account says the second,
 * and a refusal neither explains names no cause.
 */
async function rewrittenRefusal(status: number, original: string, { connection, model }: RefusalContext): Promise<string | null> {
    if (status === 401) {
        recordCredentialRejected(connection.id)
        return 'Grok sign-in refused (401): sign in to Grok again in AI providers.'
    }
    if ((status === 402 || status === 403 || status === 429) && ALLOWANCE_REFUSAL.test(original)) {
        await refreshGrokPlanLimits(connection)
        const spent = spentPlanWindow(connection.id)
        if (spent) return weeklyLimit(spent)
        if (NO_SUBSCRIPTION.test(original) && (await accountLacksGrokBuild(connection))) return GROK_NO_SUBSCRIPTION
        return GROK_ALLOWANCE_REFUSED
    }
    if ((status === 400 || status === 403 || status === 404) && MODEL_REFUSAL.test(original)) return `${GROK_MODEL_NOT_IN_PLAN} \`${model}\``
    if (status === 426) return 'Provider returned error: Grok turned away the client version this engine sends. Update the engine.'
    if (status === 403) return 'Provider returned error: Grok refused this request (403).'
    if (status >= 500) return `Grok service unavailable (${status}): ${original}`
    return null
}

function modelOfRequest(init: RequestInit | undefined, fallback: string): string {
    try {
        const model = (JSON.parse(String(init?.body)) as { model?: unknown }).model
        return typeof model === 'string' ? model : fallback
    } catch {
        return fallback
    }
}

export function grokRefusalFetch(context: GrokRequestContext & { model: string }, inner: FetchFunction = grokFetch(context)): FetchFunction {
    return async (input, init) => {
        const response = await inner(input, init)
        if (response.ok) return response
        const text = await response.text()
        const original = refusalMessageOf(text)
        const rewritten = await rewrittenRefusal(response.status, original, { connection: context.connection, model: modelOfRequest(init, context.model) })
        // xAI writes `{ "error": "<text>" }`, where the OpenAI SDK only reads `error.message`: even a
        // refusal kept as it is gets the shape that keeps its sentence.
        return refusalResponse(response, text, rewritten ?? original, 'grok')
    }
}

// The proxy keeps nothing between requests (`store: false`): each one carries its reasoning back,
// encrypted, and points at no item by id. `forceReasoning` because the SDK only reasons on the
// model ids it knows, and without it drops both the effort and the encrypted reasoning.
const grokResponsesMiddleware: LanguageModelMiddleware = {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => ({ ...params, providerOptions: { ...params.providerOptions, openai: { ...params.providerOptions?.openai, store: false, forceReasoning: true } } }),
}

export class GrokModelError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'GrokModelError'
    }
}

export type GrokLanguageModel = { model: LanguageModelV3; middleware: LanguageModelMiddleware[] }

/**
 * A Grok model in Rerun's own loop, on the OpenAI SDK's Responses model: no `name` is passed, so it
 * reads the `openai` provider options every other Responses provider of the engine already writes
 * (caching, reasoning, effort).
 */
export function grokLanguageModel(connection: LoadedConnection | null, modelId: string, sessionId: string): GrokLanguageModel {
    if (!connection || connection.config.provider !== 'grok') throw new GrokModelError('This coworker has no Grok connection to run on. Pick another model.')
    const grok = createOpenAI({ apiKey: 'grok-sign-in', baseURL: GROK_PROXY_BASE_URL, fetch: grokRefusalFetch({ connection, sessionId, model: modelId }) })
    return { model: grok.responses(modelId), middleware: [grokResponsesMiddleware] }
}

// The model a `vision_analyze` call goes to when the run's own model cannot see: the first model
// switched on for the connection that can.
export function grokVisionModel(connection: LoadedConnection | null): string | null {
    return connection?.config.models.find(grokSeesImages) ?? null
}
