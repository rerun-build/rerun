import { describe, expect, it } from 'vitest'
import { APICallError, LoadAPIKeyError, RetryError } from 'ai'
import { classifyChatError, describeSubscriptionLimit } from '@rerun/contracts'
import { classifyFinishReason, classifyProviderError, errorMessageOf, isFailedFinish, openAiCreditsError, ProviderRefusedError, refusalReason, RUN_ERROR_CODES, STREAM_CUT_RAW_REASON, unreachableEndpointError, upstreamReason } from './provider-errors.js'
import { RERUN_BUDGET_ERROR_CODE } from './budget-latch.js'

const apiError = (init: { statusCode?: number; message?: string; data?: unknown; isRetryable?: boolean; responseBody?: string }) =>
    new APICallError({
        message: init.message ?? 'boom',
        url: 'https://provider.test',
        requestBodyValues: {},
        statusCode: init.statusCode,
        data: init.data,
        isRetryable: init.isRetryable,
        responseBody: init.responseBody,
    })

// What `@ai-sdk/openai` hands over when the Responses stream carries an error event.
const openAiStreamError = (code: string, message: string) => ({ type: 'error', sequence_number: 2, error: { type: 'invalid_request_error', code, message, param: null } })

const MODEL_NOT_FOUND = 'The model `gpt-6-sol` does not exist or you do not have access to it.'

// An OpenAI API key whose account has no prepaid credits left (RER-106).
const OPENAI_NO_CREDITS = 'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.'

const OPENAI_OLD_QUOTA = 'You exceeded your current quota, please check your plan and billing details.'
const openAiQuotaBody = (message: string) => ({ error: { message, type: 'insufficient_quota', param: null, code: 'insufficient_quota' } })
const afterRetries = (lastError: unknown) => new RetryError({ message: `Failed after 3 attempts. Last error: ${errorMessageOf(lastError)}`, reason: 'maxRetriesExceeded', errors: [lastError] })

const SCHEMA_REFUSAL = 'tools.0.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level'

// What OpenRouter answers when the model provider turns a request down.
const openRouterRefusal = (raw: unknown) =>
    apiError({ statusCode: 400, message: 'Provider returned error', responseBody: JSON.stringify({ error: { message: 'Provider returned error', code: 400, metadata: { raw, provider_name: 'Anthropic' } } }) })

describe('classifyFinishReason', () => {
    it('reads a spent subscription off the raw finish reason', () => {
        expect(classifyFinishReason('length', 'usage_limit_exceeded')).toBe(RUN_ERROR_CODES.usageLimit)
    })

    it('reads a blown context window off the raw finish reason', () => {
        expect(classifyFinishReason('length', 'context_window_exceeded')).toBe(RUN_ERROR_CODES.contextWindow)
        expect(classifyFinishReason('length', 'error_max_turns')).toBe(RUN_ERROR_CODES.contextWindow)
    })

    it('reads a stream cut short off the raw finish reason', () => {
        expect(classifyFinishReason('error', STREAM_CUT_RAW_REASON)).toBe(RUN_ERROR_CODES.streamIncomplete)
    })

    it('treats a generic failed turn as an error even without a raw reason', () => {
        expect(classifyFinishReason('error', undefined)).toBe(RUN_ERROR_CODES.turnFailed)
        expect(classifyFinishReason('error', 'error_during_execution')).toBe(RUN_ERROR_CODES.turnFailed)
    })

    // A real max_tokens truncation is a successful turn; treating it as a failure would mark every
    // long answer as an error.
    it('leaves a bare length truncation alone', () => {
        expect(classifyFinishReason('length', 'max_tokens')).toBeNull()
        expect(isFailedFinish('length', 'max_tokens')).toBe(false)
        expect(isFailedFinish('stop', 'stop')).toBe(false)
    })
})

describe('classifyProviderError', () => {
    it('matches the claude usage limit message', () => {
        expect(classifyProviderError('claude', new Error('Claude AI usage limit reached|1750000000'))).toBe(RUN_ERROR_CODES.usageLimit)
    })

    // Claude Code names the window that ran out instead of saying "usage limit": these are the four
    // sentences it builds, one per rate limit type.
    it('matches the window claude code names when a plan runs out', () => {
        expect(classifyProviderError('claude', new Error("You've hit your session limit · resets 3pm"))).toBe(RUN_ERROR_CODES.usageLimit)
        expect(classifyProviderError('claude', new Error("You've hit your weekly limit · resets Nov 20, 3pm"))).toBe(RUN_ERROR_CODES.usageLimit)
        expect(classifyProviderError('claude', new Error("You've hit your Opus limit · resets 3pm"))).toBe(RUN_ERROR_CODES.usageLimit)
        expect(classifyProviderError('claude', new Error("You've hit your Sonnet limit"))).toBe(RUN_ERROR_CODES.usageLimit)
    })

    // Read off the failed runs of real boxes: none of them carried an error code, so the chat showed
    // the raw text with nothing to click.
    it('matches a model the plan does not include, and a spent plan worded differently', () => {
        expect(classifyProviderError('claude', apiError({ message: 'Fable 5.1 requires usage credits. Switch to another model to continue.' }))).toBe(RUN_ERROR_CODES.modelNotInPlan)
        expect(classifyProviderError('claude', apiError({ message: "You're out of usage credits. Switch to another model to continue." }))).toBe(RUN_ERROR_CODES.usageLimit)
        expect(classifyProviderError('claude', apiError({ message: "You've hit your org's monthly spend limit · ask your admin to raise it at claude.ai/admin-settings/usage" }))).toBe(RUN_ERROR_CODES.usageLimit)
        expect(
            classifyProviderError('codex', new Error('{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-6-astra\' model is not supported when using Codex with a ChatGPT account."}}'))
        ).toBe(RUN_ERROR_CODES.modelNotInPlan)
        expect(classifyProviderError('codex', new Error('unexpected status 404 Not Found: The model `gpt-5.5` does not exist or you do not have access to it.'))).toBe(RUN_ERROR_CODES.modelNotInPlan)
        expect(classifyProviderError('codex', new Error("You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro) or try again at 4:44 PM."))).toBe(RUN_ERROR_CODES.usageLimit)
    })

    // The body a ChatGPT account without the model answers with, as the hub stored it for 16 failed
    // runs: a spent quota resets, a missing model does not, so the two are told apart.
    it('reads a model the ChatGPT plan leaves out apart from a spent quota', () => {
        const body = '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-6.1-sol\' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}}'
        expect(classifyProviderError('codex', new Error(body))).toBe(RUN_ERROR_CODES.modelNotInPlan)
        expect(classifyProviderError('codex', apiError({ message: body, statusCode: 400, responseBody: body }))).toBe(RUN_ERROR_CODES.modelNotInPlan)
        expect(classifyProviderError('codex', new Error('usage_limit_exceeded'))).toBe(RUN_ERROR_CODES.usageLimit)
    })

    it('matches an expired CLI login', () => {
        expect(classifyProviderError('claude', new LoadAPIKeyError({ message: 'Authentication failed. Ensure Claude CLI is logged in.' }))).toBe(RUN_ERROR_CODES.unauthorized)
        expect(classifyProviderError('codex', apiError({ statusCode: 401 }))).toBe(RUN_ERROR_CODES.unauthorized)
        expect(classifyProviderError('codex', apiError({ data: { exitCode: 401 } }))).toBe(RUN_ERROR_CODES.unauthorized)
        expect(classifyProviderError('claude', new Error('Failed to authenticate. API Error: 401 Invalid bearer token'))).toBe(RUN_ERROR_CODES.unauthorized)
        expect(classifyProviderError('openrouter', new Error('No auth credentials found'))).toBe(RUN_ERROR_CODES.unauthorized)
    })

    it('matches an overloaded upstream', () => {
        expect(classifyProviderError('anthropic', apiError({ statusCode: 429 }))).toBe(RUN_ERROR_CODES.overloaded)
        expect(classifyProviderError('claude', new Error('Claude is overloaded, try again'))).toBe(RUN_ERROR_CODES.overloaded)
    })

    it('matches a model the provider has no room for right now', () => {
        expect(classifyProviderError('codex', new Error('Selected model is at capacity. Please try a different model.'))).toBe(RUN_ERROR_CODES.overloaded)
        expect(classifyProviderError('codex', new Error('exceeded retry limit, last status: 429 Too Many Requests'))).toBe(RUN_ERROR_CODES.overloaded)
    })

    it('delegates the managed budget to the budget latch', () => {
        expect(classifyProviderError('rerun', new Error(`AI_APICallError: ${RERUN_BUDGET_ERROR_CODE}`))).toBe(RERUN_BUDGET_ERROR_CODE)
        // Only the managed provider bills the workspace budget.
        expect(classifyProviderError('openai', new Error(`AI_APICallError: ${RERUN_BUDGET_ERROR_CODE}`))).toBeNull()
    })

    it('reads an overloaded provider through the retries the AI SDK gave up on', () => {
        const highDemand = 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.'
        const lastError = apiError({ statusCode: 503, message: highDemand, isRetryable: true })
        const retried = new RetryError({ message: `Failed after 3 attempts. Last error: ${highDemand}`, reason: 'maxRetriesExceeded', errors: [lastError, lastError, lastError] })
        expect(classifyProviderError('google', retried)).toBe(RUN_ERROR_CODES.overloaded)
        const rateLimited = apiError({ statusCode: 429, message: 'Resource exhausted', isRetryable: true })
        expect(classifyProviderError('google', new RetryError({ message: 'Failed after 3 attempts.', reason: 'maxRetriesExceeded', errors: [rateLimited] }))).toBe(RUN_ERROR_CODES.overloaded)
    })

    it('leaves an unrecognised failure unclassified', () => {
        expect(classifyProviderError('openai', new Error('ECONNRESET'))).toBeNull()
    })

    it('reads a 400 as a refusal, unless its reason says otherwise', () => {
        expect(classifyProviderError('rerun', openRouterRefusal(JSON.stringify({ message: SCHEMA_REFUSAL })))).toBe(RUN_ERROR_CODES.refused)
        expect(classifyProviderError('openai', apiError({ statusCode: 400 }))).toBe(RUN_ERROR_CODES.refused)
        expect(classifyProviderError('rerun', openRouterRefusal(JSON.stringify({ message: 'prompt is too long: 210000 tokens > 200000 maximum' })))).toBe(RUN_ERROR_CODES.contextWindow)
        expect(classifyProviderError('google', apiError({ statusCode: 400, message: 'Invalid API key' }))).toBe(RUN_ERROR_CODES.unauthorized)
    })

    it('reads an error event of the OpenAI Responses stream', () => {
        expect(classifyProviderError('openai', openAiStreamError('model_not_found', MODEL_NOT_FOUND))).toBe(RUN_ERROR_CODES.modelNotInPlan)
    })

    // Read off the four failed runs of a box whose OpenAI key had no credits: stored without a code,
    // they reached the hub as a bare run_error and the chat as the raw sentence.
    it('reads an OpenAI API account out of credits as a spent quota', () => {
        const streamed = openAiStreamError('insufficient_quota', OPENAI_NO_CREDITS)
        expect(errorMessageOf(streamed)).toBe(OPENAI_NO_CREDITS)
        expect(classifyProviderError('openai', streamed)).toBe(RUN_ERROR_CODES.usageLimit)
        const refused = apiError({ statusCode: 429, message: OPENAI_NO_CREDITS, isRetryable: true, responseBody: JSON.stringify({ error: { type: 'insufficient_quota', code: 'insufficient_quota', message: OPENAI_NO_CREDITS } }) })
        expect(classifyProviderError('openai', refused)).toBe(RUN_ERROR_CODES.usageLimit)
    })

    // OpenAI's older wording for the same code reads like any rate limit: only the body's code tells.
    it('reads insufficient_quota from the body of a refused call', () => {
        const refused = apiError({ statusCode: 429, message: OPENAI_OLD_QUOTA, isRetryable: true, data: openAiQuotaBody(OPENAI_OLD_QUOTA), responseBody: JSON.stringify(openAiQuotaBody(OPENAI_OLD_QUOTA)) })
        expect(classifyProviderError('openai', refused)).toBe(RUN_ERROR_CODES.usageLimit)
        const bodyOnly = apiError({ statusCode: 429, message: OPENAI_OLD_QUOTA, isRetryable: true, responseBody: JSON.stringify(openAiQuotaBody(OPENAI_OLD_QUOTA)) })
        expect(classifyProviderError('openai', bodyOnly)).toBe(RUN_ERROR_CODES.usageLimit)
        expect(classifyProviderError('openai', afterRetries(refused))).toBe(RUN_ERROR_CODES.usageLimit)
    })

    it('keeps a Gemini quota 429 as a rate limit', () => {
        const rateLimited = apiError({ statusCode: 429, message: 'You exceeded your current quota, please check your plan and billing details.', isRetryable: true })
        expect(classifyProviderError('google', rateLimited)).toBe(RUN_ERROR_CODES.overloaded)
    })
})

describe('openAiCreditsError', () => {
    const refused = (message: string) => apiError({ statusCode: 429, message, isRetryable: true, data: openAiQuotaBody(message), responseBody: JSON.stringify(openAiQuotaBody(message)) })

    it('stores an OpenAI account out of credits under the sentence the chat names OpenAI by', () => {
        for (const error of [openAiStreamError('insufficient_quota', OPENAI_OLD_QUOTA), refused(OPENAI_OLD_QUOTA), afterRetries(refused(OPENAI_OLD_QUOTA)), refused(OPENAI_NO_CREDITS)]) {
            const stored = errorMessageOf(openAiCreditsError('openai', error))
            expect(stored).toMatch(/^OpenAiCreditsError: OpenAI API credits used up: You (exceeded|have no credits)/)
            expect(classifyChatError(stored)).toBe('usage_limit')
            expect(describeSubscriptionLimit(stored)).toEqual({ plan: 'openai', scope: 'credits' })
        }
    })

    it('leaves another provider and another error as they are', () => {
        expect(openAiCreditsError('custom', refused(OPENAI_OLD_QUOTA))).toBeNull()
        expect(openAiCreditsError('openai', apiError({ statusCode: 429, message: 'Rate limit reached for requests', isRetryable: true }))).toBeNull()
    })
})

describe('errorMessageOf', () => {
    it('keeps the sentence of an error event of the OpenAI Responses stream', () => {
        expect(errorMessageOf(openAiStreamError('model_not_found', MODEL_NOT_FOUND))).toBe(MODEL_NOT_FOUND)
        expect(errorMessageOf({ message: 'You exceeded your current quota.' })).toBe('You exceeded your current quota.')
    })

    it('keeps the class name of an Error, which the chat strips', () => {
        expect(errorMessageOf(apiError({ message: 'Payment Required' }))).toBe('AI_APICallError: Payment Required')
    })

    it('never stores "[object Object]" for an object it cannot read', () => {
        expect(errorMessageOf({ code: 'server_error' })).toBe('{"code":"server_error"}')
    })
})

describe('upstreamReason', () => {
    it("reads the model provider's message out of OpenRouter's metadata", () => {
        expect(upstreamReason(openRouterRefusal(JSON.stringify({ message: SCHEMA_REFUSAL })))).toBe(SCHEMA_REFUSAL)
        expect(upstreamReason(openRouterRefusal(JSON.stringify({ type: 'error', error: { message: SCHEMA_REFUSAL } })))).toBe(SCHEMA_REFUSAL)
        expect(upstreamReason(openRouterRefusal('plain text refusal'))).toBe('plain text refusal')
    })

    it('falls back to the error message of the body when it says more than the error', () => {
        expect(upstreamReason(apiError({ statusCode: 400, message: 'Bad Request', responseBody: JSON.stringify({ error: { message: 'max_tokens is too large' } }) }))).toBe('max_tokens is too large')
        expect(upstreamReason(apiError({ statusCode: 400, message: 'Bad Request', responseBody: JSON.stringify({ error: { message: 'Bad Request' } }) }))).toBeNull()
    })

    it('has nothing to say without a readable body', () => {
        expect(upstreamReason(apiError({ statusCode: 400 }))).toBeNull()
        expect(upstreamReason(apiError({ statusCode: 400, responseBody: '<html>502</html>' }))).toBeNull()
        expect(upstreamReason(new Error('Provider returned error'))).toBeNull()
    })
})

describe('refusalReason', () => {
    it("keeps Gemini's reason, which the Google provider already made the error's own message", () => {
        const reason = "Invalid value at 'tools[0].function_declarations[27].parameters.properties[1].value.enum[0]' (TYPE_STRING), true"
        const refusal = apiError({ statusCode: 400, message: reason, responseBody: JSON.stringify({ error: { code: 400, message: reason, status: 'INVALID_ARGUMENT' } }) })
        expect(classifyProviderError('google', refusal)).toBe(RUN_ERROR_CODES.refused)
        expect(refusalReason(refusal)).toBe(reason)
    })

    it("prefers the model provider's message, and never repeats OpenRouter's bare refusal", () => {
        expect(refusalReason(openRouterRefusal(JSON.stringify({ message: SCHEMA_REFUSAL })))).toBe(SCHEMA_REFUSAL)
        expect(refusalReason(apiError({ statusCode: 400, message: 'Provider returned error', responseBody: JSON.stringify({ error: { message: 'Provider returned error' } }) }))).toBeNull()
        expect(refusalReason(apiError({ statusCode: 400 }))).toBeNull()
    })
})

describe('ProviderRefusedError', () => {
    it('keeps the words the chat classifies, with the reason after them', () => {
        expect(new ProviderRefusedError(SCHEMA_REFUSAL).message).toBe(`Provider returned error: ${SCHEMA_REFUSAL}`)
        expect(new ProviderRefusedError(null).message).toBe('Provider returned error')
    })
})

describe('unreachableEndpointError', () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' }) })

    it('names the address and the reason a custom endpoint could not be reached', () => {
        const error = unreachableEndpointError('http://localhost:11434/v1', new APICallError({ message: 'Cannot connect to API: fetch failed', url: 'http://localhost:11434/v1/chat/completions', requestBodyValues: {}, cause: refused }))
        expect(error?.message).toBe('Could not reach the custom endpoint at localhost:11434 (ECONNREFUSED). Check that the server is running and reachable from the engine.')
    })

    it('looks through the retries the SDK wraps the last attempt in', () => {
        const last = new APICallError({ message: 'Cannot connect to API: getaddrinfo ENOTFOUND gpu.lan', url: 'http://gpu.lan/v1', requestBodyValues: {} })
        expect(unreachableEndpointError('http://gpu.lan/v1', new RetryError({ message: 'failed after 3 attempts', reason: 'maxRetriesExceeded', errors: [last] }))?.message).toContain('gpu.lan (ENOTFOUND)')
    })

    it('leaves an error the server answered alone', () => {
        expect(unreachableEndpointError('http://localhost:11434/v1', new APICallError({ message: 'Bad request', url: 'u', requestBodyValues: {}, statusCode: 400 }))).toBeNull()
    })
})
