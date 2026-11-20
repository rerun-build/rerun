import type { DiscoveredModel, ProviderModel } from '@moldwright/contracts'

const NOT_CHAT = /embedding|tts|whisper|dall-e|moderation|image|audio|realtime|transcribe|sora|search|computer-use|babbage|davinci/i
const PER_MILLION = 1_000_000
const MAX_LABEL_CHARS = 200
const MIN_CONTEXT_WINDOW = 4096
const MAX_CONTEXT_WINDOW = 10_000_000

type Row = Record<string, unknown>

function rowsOf(body: unknown, key: string): Row[] {
    const rows = (body as Record<string, unknown> | null)?.[key]
    return Array.isArray(rows) ? rows.filter((row): row is Row => typeof row === 'object' && row !== null) : []
}

function text(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function label(value: unknown): string | undefined {
    return text(value)?.slice(0, MAX_LABEL_CHARS)
}

function contextWindow(value: unknown): number | null {
    return typeof value === 'number' && value >= MIN_CONTEXT_WINDOW && value <= MAX_CONTEXT_WINDOW ? value : null
}

function perMillion(value: unknown): number | null {
    const perToken = typeof value === 'string' && value.trim() ? Number(value) : NaN
    return Number.isFinite(perToken) && perToken >= 0 ? Number((perToken * PER_MILLION).toFixed(6)) : null
}

function unique(models: DiscoveredModel[]): DiscoveredModel[] {
    const seen = new Set<string>()
    return models.filter(model => !seen.has(model.id) && seen.add(model.id))
}

function openrouterPrice(pricing: unknown): ProviderModel['price'] | undefined {
    const row = (pricing ?? {}) as Row
    const input = perMillion(row.prompt)
    const output = perMillion(row.completion)
    return input === null || output === null ? undefined : { input, output, cacheRead: perMillion(row.input_cache_read) }
}

function writesText(architecture: unknown): boolean {
    const output = (architecture as Row | null)?.output_modalities
    return !Array.isArray(output) || output.includes('text')
}

export function parseOpenrouterModels(body: unknown): DiscoveredModel[] {
    const models: DiscoveredModel[] = []
    for (const row of rowsOf(body, 'data')) {
        const id = text(row.id)
        if (!id || id.includes(':') || !writesText(row.architecture)) continue
        const price = openrouterPrice(row.pricing)
        models.push({ id, label: label(row.name), contextWindow: contextWindow(row.context_length), ...(price ? { price } : {}) })
    }
    return unique(models)
}

export function parseOpenaiModels(body: unknown): DiscoveredModel[] {
    const ids = rowsOf(body, 'data').flatMap(row => text(row.id) ?? [])
    return unique(ids.filter(id => !NOT_CHAT.test(id)).map(id => ({ id, contextWindow: null })))
}

export function parseGoogleModels(body: unknown): DiscoveredModel[] {
    const models: DiscoveredModel[] = []
    for (const row of rowsOf(body, 'models')) {
        const id = text(row.name)?.replace(/^models\//, '')
        const methods = Array.isArray(row.supportedGenerationMethods) ? row.supportedGenerationMethods : []
        if (!id || NOT_CHAT.test(id) || !methods.includes('generateContent')) continue
        models.push({ id, label: label(row.displayName), contextWindow: contextWindow(row.inputTokenLimit) })
    }
    return unique(models)
}

export function googleNextPage(body: unknown): string | null {
    return text((body as Row | null)?.nextPageToken) ?? null
}

export function parseAnthropicModels(body: unknown): DiscoveredModel[] {
    const models: DiscoveredModel[] = []
    for (const row of rowsOf(body, 'data')) {
        const id = text(row.id)
        if (id) models.push({ id, label: label(row.display_name), contextWindow: contextWindow(row.max_input_tokens) })
    }
    return unique(models)
}

export function anthropicNextPage(body: unknown): string | null {
    const page = body as Row | null
    return page?.has_more === true ? (text(page.last_id) ?? null) : null
}
