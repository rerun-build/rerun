import { CONNECTION_TOKEN_KEY, CUSTOM_DEFAULT_CONTEXT_WINDOW, type CustomProbeInput, type CustomProbeResult, type DiscoveredModel } from '@moldwright/contracts'
import { logger } from '../lib/logger.js'
import type { LoadedConnection } from './types.js'

const FETCH_TIMEOUT_MS = 10_000
const STALE_AFTER_MS = 30 * 60_000

type Reading = { models: DiscoveredModel[]; at: number }
const readings = new Map<string, Reading>()
const attemptedAt = new Map<string, number>()
const inFlight = new Map<string, Promise<void>>()

export function trimBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/, '')
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

function positiveNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function parseModelList(body: unknown): DiscoveredModel[] {
    const rows = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown })?.data) ? (body as { data: unknown[] }).data : []
    const models: DiscoveredModel[] = []
    for (const row of rows) {
        const entry = row as Record<string, unknown> | null
        const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
        if (!id || models.some(model => model.id === id)) continue
        const contextWindow = positiveNumber(entry?.context_length) ?? positiveNumber(entry?.max_model_len) ?? positiveNumber(entry?.context_window) ?? positiveNumber(entry?.max_context_length)
        models.push({ id, contextWindow })
    }
    return models
}

type Attempt = { status: 'ok'; models: DiscoveredModel[] } | { status: 'unreachable'; detail: string } | { status: 'unauthorized'; detail: string } | { status: 'not_listed'; detail: string }

async function listModels(baseUrl: string, apiKey: string | undefined): Promise<Attempt> {
    let response: Response
    try {
        response = await fetch(`${baseUrl}/models`, { headers: authHeaders(apiKey), redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    } catch (err) {
        return { status: 'unreachable', detail: networkDetail(err) }
    }
    if (response.status === 401 || response.status === 403) return { status: 'unauthorized', detail: `${response.status} ${await bodySnippet(response)}`.trim() }
    if (!response.ok) return { status: 'not_listed', detail: `${response.status} ${await bodySnippet(response)}`.trim() }
    const models = parseModelList(await response.json().catch(() => null))
    return models.length ? { status: 'ok', models } : { status: 'not_listed', detail: 'The server listed no model.' }
}

type ChatAttempt = { status: 'ok' } | { status: 'unreachable'; detail: string } | { status: 'unauthorized'; detail: string } | { status: 'model_refused'; detail: string }

async function askOneToken(baseUrl: string, apiKey: string | undefined, model: string): Promise<ChatAttempt> {
    let response: Response
    try {
        response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say ok.' }], max_tokens: 1 }),
            redirect: 'error',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS * 3),
        })
    } catch (err) {
        return { status: 'unreachable', detail: networkDetail(err) }
    }
    if (response.status === 401 || response.status === 403) return { status: 'unauthorized', detail: `${response.status} ${await bodySnippet(response)}`.trim() }
    if (!response.ok) return { status: 'model_refused', detail: `${response.status} ${await bodySnippet(response)}`.trim() }
    return { status: 'ok' }
}

async function bodySnippet(response: Response): Promise<string> {
    const text = await response.text().catch(() => '')
    return text.replace(/\s+/g, ' ').slice(0, 200)
}

function networkDetail(err: unknown): string {
    const cause = (err as { cause?: { code?: unknown } })?.cause
    if (typeof cause?.code === 'string') return cause.code
    if ((err as { name?: unknown })?.name === 'TimeoutError') return 'timed out'
    return err instanceof Error ? err.message : String(err)
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])

export function candidateBaseUrls(baseUrl: string): string[] {
    const trimmed = trimBaseUrl(baseUrl)
    const url = new URL(trimmed)
    if (!LOOPBACK_HOSTS.has(url.hostname)) return [trimmed]
    url.hostname = 'host.docker.internal'
    return [trimmed, trimBaseUrl(url.toString())]
}

export async function probeCustomEndpoint(input: CustomProbeInput): Promise<CustomProbeResult> {
    const apiKey = input.apiKey || undefined
    let unreachable: CustomProbeResult | null = null
    for (const baseUrl of candidateBaseUrls(input.baseUrl)) {
        const listed = await listModels(baseUrl, apiKey)
        if (listed.status === 'unreachable') {
            unreachable ??= { baseUrl: trimBaseUrl(input.baseUrl), models: [], problem: 'unreachable', detail: listed.detail }
            continue
        }
        if (listed.status === 'unauthorized') return { baseUrl, models: [], problem: 'unauthorized', detail: listed.detail }
        if (!input.model) return listed.status === 'ok' ? { baseUrl, models: listed.models, problem: null, detail: null } : { baseUrl, models: [], problem: 'not_listed', detail: listed.detail }

        const listedModels = listed.status === 'ok' ? listed.models : []
        const chat = await askOneToken(baseUrl, apiKey, input.model)
        if (chat.status === 'ok') {
            const typed = listedModels.find(model => model.id === input.model) ?? { id: input.model, contextWindow: null }
            return { baseUrl, models: [typed, ...listedModels.filter(model => model.id !== input.model)], problem: null, detail: null }
        }
        if (chat.status === 'unreachable') return { baseUrl, models: [], problem: 'unreachable', detail: chat.detail }
        return { baseUrl, models: listedModels, problem: chat.status, detail: chat.detail }
    }
    return unreachable ?? { baseUrl: trimBaseUrl(input.baseUrl), models: [], problem: 'unreachable', detail: null }
}

function connectionKey(connection: LoadedConnection): string | undefined {
    return connection.env[CONNECTION_TOKEN_KEY.custom] || undefined
}

export function refreshCustomCatalog(connection: LoadedConnection): Promise<void> {
    const running = inFlight.get(connection.id)
    if (running) return running
    const baseUrl = connection.config.baseUrl
    if (connection.config.provider !== 'custom' || !baseUrl) return Promise.resolve()
    attemptedAt.set(connection.id, Date.now())
    const attempt = listModels(trimBaseUrl(baseUrl), connectionKey(connection))
        .then(listed => {
            if (listed.status === 'ok') readings.set(connection.id, { models: listed.models, at: Date.now() })
            else logger.warn({ connection: connection.id, status: listed.status, detail: listed.detail }, 'custom endpoint model list failed')
        })
        .catch(err => logger.warn({ connection: connection.id, err: String(err) }, 'custom endpoint model list failed'))
        .finally(() => inFlight.delete(connection.id))
    inFlight.set(connection.id, attempt)
    return attempt
}

export function refreshStaleCustomCatalogs(connections: LoadedConnection[]): void {
    for (const connection of connections) {
        if (connection.config.provider !== 'custom') continue
        if (Date.now() - (attemptedAt.get(connection.id) ?? 0) < STALE_AFTER_MS) continue
        void refreshCustomCatalog(connection)
    }
}

export function customDiscoveredModels(connectionId: string): DiscoveredModel[] | null {
    return readings.get(connectionId)?.models ?? null
}

export function customMeasuredContextWindow(connection: LoadedConnection | null | undefined, model: string): number | undefined {
    const listed = connection ? readings.get(connection.id)?.models.find(entry => entry.id === model)?.contextWindow : null
    return listed ?? connection?.config.contextWindow ?? undefined
}

export function customContextWindow(connection: LoadedConnection | null | undefined, model: string): number {
    return customMeasuredContextWindow(connection, model) ?? CUSTOM_DEFAULT_CONTEXT_WINDOW
}

export function forgetCustomCatalog(connectionId: string): void {
    readings.delete(connectionId)
    attemptedAt.delete(connectionId)
}

export function resetCustomCatalogForTests(): void {
    readings.clear()
    attemptedAt.clear()
    inFlight.clear()
}
