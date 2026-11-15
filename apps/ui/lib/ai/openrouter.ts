import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

export function hasOpenRouterKey(): boolean {
    return Boolean(process.env.OPENROUTER_API_KEY)
}

export function openrouter(modelId: string) {
    return createOpenAICompatible({
        name: 'openrouter',
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        supportsStructuredOutputs: true,
    })(modelId)
}
