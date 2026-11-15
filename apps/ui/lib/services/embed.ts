import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { embed } from 'ai'
import type { ServiceManifest } from './manifest'

const EMBED_BASE_URL = process.env.RERUN_EMBED_BASE_URL ?? 'https://openrouter.ai/api/v1'
const EMBED_MODEL = process.env.RERUN_EMBED_MODEL ?? 'openai/text-embedding-3-small'

function embedModel() {
    const apiKey = process.env.RERUN_EMBED_API_KEY
    if (!apiKey) return null
    return createOpenAICompatible({ name: 'openrouter', apiKey, baseURL: EMBED_BASE_URL }).textEmbeddingModel(EMBED_MODEL)
}

const EMBED_MAX_CHARS = 16_000
const EMBED_RETRY_CHARS = 6_000
const TOO_LONG = /maximum (input|context) length|too many tokens/i

export async function embedText(text: string): Promise<number[] | null> {
    const model = embedModel()
    if (!model) return null
    try {
        const { embedding } = await embed({ model, value: text.slice(0, EMBED_MAX_CHARS) })
        return embedding
    } catch (error) {
        if (text.length <= EMBED_RETRY_CHARS || !(error instanceof Error) || !TOO_LONG.test(error.message)) throw error
        const { embedding } = await embed({ model, value: text.slice(0, EMBED_RETRY_CHARS) })
        return embedding
    }
}

export function serviceDocument(m: ServiceManifest): string {
    const parts: string[] = [m.name, m.category, m.summary, m.description]
    for (const s of m.skills) parts.push(s.name, s.description)
    for (const method of m.authMethods) {
        if (method.label) parts.push(method.label)
        for (const srv of method.mcpServers) parts.push(srv.name)
    }
    return parts.filter(Boolean).join('\n')
}

export function toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`
}
