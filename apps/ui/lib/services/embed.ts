import { createHash } from 'node:crypto'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { embed } from 'ai'
import type { ServiceManifest } from './manifest'

// Embeddings for the service library's semantic search and engine memory recall, via
// OpenRouter. They use a dedicated key so embedding traffic and Rerun traffic are
// billed independently. Default model is OpenAI text-embedding-3-small (1536 dims), so
// the `vector(1536)` columns stay consistent.
// Returns null when no key is configured — callers fall back to keyword search.

const EMBED_BASE_URL = process.env.RERUN_EMBED_BASE_URL ?? 'https://openrouter.ai/api/v1'
const EMBED_MODEL = process.env.RERUN_EMBED_MODEL ?? 'openai/text-embedding-3-small'

function embedModel() {
    const apiKey = process.env.RERUN_EMBED_API_KEY
    if (!apiKey) return null
    return createOpenAICompatible({ name: 'openrouter', apiKey, baseURL: EMBED_BASE_URL }).textEmbeddingModel(EMBED_MODEL)
}

// The model refuses anything past 8192 tokens, and a long memory or report is well past it. Four
// characters a token holds for English prose only: JSON and code spend about one for two characters,
// which this head fits. The head of a document carries what it is about, which is what a search
// matches on.
const EMBED_MAX_CHARS = 16_000
// CJK text spends about a token a character, so a head the model still refuses is cut to this.
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

// A coworker recalls its memories with the embedding of the message it was just sent, and waits for
// it before calling its model. The hub holds that message a moment before the engine does: the chat
// routes ask for the embedding as the message comes in, and the engine's own request, a few hundred
// milliseconds later, joins the one already under way instead of starting from nothing.
//
// Kept per workspace and for a moment only, in this process: an engine asking for another text, or
// reaching another instance, gets a fresh embedding as before. A failure is not kept.
const SHARED_MS = 30_000
const SHARED_MAX = 500

const shared = new Map<string, { vector: Promise<number[] | null>; until: number }>()

export function embedTextShared(workspaceId: number, text: string): Promise<number[] | null> {
    const key = `${workspaceId}:${createHash('sha256').update(text).digest('base64')}`
    const now = Date.now()
    const known = shared.get(key)
    if (known && known.until > now) return known.vector

    if (shared.size >= SHARED_MAX) {
        for (const [other, entry] of shared) if (entry.until <= now) shared.delete(other)
        if (shared.size >= SHARED_MAX) shared.clear()
    }
    const vector = embedText(text)
    const entry = { vector, until: now + SHARED_MS }
    shared.set(key, entry)
    const forget = () => {
        if (shared.get(key) === entry) shared.delete(key)
    }
    vector.then(embedding => embedding === null && forget(), forget)
    return vector
}

// The searchable "document" for a service: everything a natural-language capability query
// might match against — name, category, the human summary/description, and the skills the
// service installs (which describe what the agent will be able to do).
export function serviceDocument(m: ServiceManifest): string {
    const parts: string[] = [m.name, m.category, m.summary, m.description]
    for (const s of m.skills) parts.push(s.name, s.description)
    for (const method of m.authMethods) {
        if (method.label) parts.push(method.label)
        for (const srv of method.mcpServers) parts.push(srv.name)
    }
    return parts.filter(Boolean).join('\n')
}

// pgvector accepts a bracketed literal for its text input format.
export function toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`
}
