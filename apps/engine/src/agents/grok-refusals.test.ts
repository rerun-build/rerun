import { vi } from 'vitest'

vi.mock('../connections/grok-token.js', () => ({
    grokAccessToken: (connection: { env: Record<string, string> }) => connection.env.GROK_OAUTH_TOKEN,
    ensureGrokToken: async () => {},
}))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { APICallError, generateText, wrapLanguageModel } = await import('ai')
const { describeSubscriptionLimit } = await import('@rerun/contracts')
const { grokLanguageModel } = await import('./grok.js')
const { classifyProviderError, RUN_ERROR_CODES } = await import('../runtime/provider-errors.js')
const { forgetCredentialRejected, isCredentialRejected } = await import('../connections/credential-rejections.js')
const { forgetPlanLimits, readPlanLimits } = await import('../connections/plan-limits.js')

const TEAM = '00000000-1111-4222-8333-444444444444'
const realFetch = globalThis.fetch
const period = { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-11-23T14:53:50.529+00:00', end: '2026-11-30T14:53:50.529+00:00' }

let billing: Record<string, unknown>
let refusal: () => Response
let calls: string[]

function grokConnection() {
    return { id: 'grokcnx', config: { name: 'Grok', provider: 'grok' as const, models: ['grok-4.6'], extraModels: [], createdAt: '' }, env: { GROK_OAUTH_TOKEN: 'access-1' } }
}

beforeEach(() => {
    calls = []
    billing = { config: { currentPeriod: period } }
    forgetPlanLimits('grokcnx')
    forgetCredentialRejected('grokcnx')
    globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input)
        calls.push(url)
        if (url.endsWith('/billing?format=credits')) return Response.json(billing)
        return refusal()
    }) as typeof fetch
})

afterEach(() => {
    globalThis.fetch = realFetch
})

async function runRefused(): Promise<unknown> {
    const grok = grokLanguageModel(grokConnection(), 'grok-4.6', 'session-1')
    try {
        await generateText({ model: wrapLanguageModel({ model: grok.model, middleware: grok.middleware }), prompt: 'Hi', maxRetries: 0 })
    } catch (error) {
        return error
    }
    throw new Error('the run went through')
}

const messageOf = (error: unknown) => (APICallError.isInstance(error) ? error.message : String(error))

describe('a Grok refusal', () => {
    it('reads a spent week as the usage limit of the Grok plan, with its reset, never as a rate limit', async () => {
        billing = { config: { currentPeriod: period, creditUsagePercent: 100 } }
        refusal = () => Response.json({ error: `You have run out of credits or need a Grok subscription. Team ${TEAM}.` }, { status: 403 })
        const error = await runRefused()
        expect(messageOf(error)).toBe('Grok weekly limit reached · resets Nov 30, 2:53 PM UTC')
        expect(classifyProviderError('grok', error)).toBe(RUN_ERROR_CODES.usageLimit)
        expect(describeSubscriptionLimit(messageOf(error))).toEqual({ plan: 'grok', scope: 'weekly', resetsAt: 'Nov 30, 2:53 PM UTC' })
        expect(readPlanLimits('grokcnx')?.windows[0]?.usedPercent).toBe(100)
    })

    it('reads the same sentence with the week far from spent as an account without the plan', async () => {
        billing = { config: { currentPeriod: period, creditUsagePercent: 12 } }
        refusal = () => Response.json({ error: 'You have run out of credits or need a Grok subscription.' }, { status: 403 })
        const error = await runRefused()
        expect(messageOf(error)).toBe('No Grok subscription on this xAI account')
        expect(classifyProviderError('grok', error)).toBe(RUN_ERROR_CODES.modelNotInPlan)
    })

    it('reads a quota 429 as the week spent, and leaves a plain rate limit to the retries', async () => {
        billing = { config: { currentPeriod: period, creditUsagePercent: 100 } }
        refusal = () => Response.json({ error: 'You have used all available credits.' }, { status: 429 })
        expect(classifyProviderError('grok', await runRefused())).toBe(RUN_ERROR_CODES.usageLimit)

        refusal = () => Response.json({ error: 'Rate limit exceeded' }, { status: 429 })
        const throttled = await runRefused()
        expect(classifyProviderError('grok', throttled)).toBe(RUN_ERROR_CODES.overloaded)
        expect(calls.filter(url => url.endsWith('/billing?format=credits'))).toHaveLength(1)
    })

    it('names the model the plan does not serve, and never the team xAI names', async () => {
        refusal = () => Response.json({ code: 'not-found', error: `The model grok-4.6 does not exist or your team ${TEAM} does not have access to it.` }, { status: 404 })
        const error = await runRefused()
        expect(messageOf(error)).toBe('Grok plan does not include `grok-4.6`')
        expect(JSON.stringify(error)).not.toContain(TEAM)
        expect(classifyProviderError('grok', error)).toBe(RUN_ERROR_CODES.modelNotInPlan)
        expect(describeSubscriptionLimit(messageOf(error))).toMatchObject({ plan: 'grok', scope: 'not_in_plan', modelName: 'Grok 4.6' })
    })

    it('reads a token refused after its renewal as a sign-in to redo', async () => {
        refusal = () => Response.json({ error: 'Invalid or expired credentials (auth_kind=bearer, x_xai_token_auth=xai-grok-cli)' }, { status: 401 })
        const error = await runRefused()
        expect(classifyProviderError('grok', error)).toBe(RUN_ERROR_CODES.unauthorized)
        expect(isCredentialRejected('grokcnx')).toBe(true)
    })

    it('keeps any other 403 out of the stored error, and a 5xx as the proxy wrote it', async () => {
        refusal = () => Response.json({ error: `Forbidden for team ${TEAM}` }, { status: 403 })
        expect(messageOf(await runRefused())).toBe('Provider returned error: Grok refused this request (403).')
        refusal = () => Response.json({ error: 'Grok is at capacity, try again' }, { status: 503 })
        expect(classifyProviderError('grok', await runRefused())).toBe(RUN_ERROR_CODES.overloaded)
    })
})
