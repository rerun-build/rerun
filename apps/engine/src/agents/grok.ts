import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelMiddleware, wrapLanguageModel } from 'ai'
import { GROK_PROXY_BASE_URL, grokSeesImages } from '@rerun/contracts'
import { grokFetch } from '../connections/grok-proxy.js'
import type { LoadedConnection } from '../connections/types.js'

type LanguageModelV3 = Parameters<typeof wrapLanguageModel>[0]['model']

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
    const grok = createOpenAI({ apiKey: 'grok-sign-in', baseURL: GROK_PROXY_BASE_URL, fetch: grokFetch({ connection, sessionId }) })
    return { model: grok.responses(modelId), middleware: [grokResponsesMiddleware] }
}

// The model a `vision_analyze` call goes to when the run's own model cannot see: the first model
// switched on for the connection that can.
export function grokVisionModel(connection: LoadedConnection | null): string | null {
    return connection?.config.models.find(grokSeesImages) ?? null
}
