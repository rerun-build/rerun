import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { readCachedSearch, storeSearch } from '@/lib/search/cache'
import { searchTheWeb } from '@/lib/search/web-search'

import { POST } from './route'

const insert = vi.fn()
const from = vi.fn(() => ({ insert }))

vi.mock('@/app/api/_services/workspace-engine.service', () => ({ authenticateEngineToken: vi.fn() }))
vi.mock('@/lib/search/cache', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/search/cache')>()), readCachedSearch: vi.fn(), storeSearch: vi.fn() }))
vi.mock('@/lib/search/web-search', () => ({ WEB_SEARCH_PAGE_SIZE: 20, searchTheWeb: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn(() => ({ from })) }))

const WORKSPACE_ID = 7
const RESULTS = [{ title: 'Rerun', url: 'https://rerun.build', snippet: 'Coworkers that run' }]
const PAGE = Array.from({ length: 20 }, (_, i) => ({ title: `Result ${i + 1}`, url: `https://example.com/${i + 1}`, snippet: '' }))

function searchRequest({ token = 'engine-key', body = { query: 'rerun', maxResults: 3 } }: { token?: string | null; body?: unknown } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-rerun-agent': 'surfer' }
    if (token !== null) headers.authorization = `Bearer ${token}`
    return new Request('https://rerun.test/api/search', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

describe('POST /api/search', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        vi.mocked(authenticateEngineToken).mockImplementation(async token => (token === 'engine-key' ? { workspaceId: WORKSPACE_ID, isSandbox: false } : null))
        vi.mocked(searchTheWeb).mockResolvedValue({ status: 200, ok: true, results: RESULTS })
        insert.mockResolvedValue({ error: null })
        vi.mocked(readCachedSearch).mockResolvedValue(null)
        vi.mocked(storeSearch).mockResolvedValue(undefined)
    })

    it('refuses a request without an engine key', async () => {
        const response = await POST(searchRequest({ token: null }))

        expect(response.status).toBe(401)
        expect(searchTheWeb).not.toHaveBeenCalled()
    })

    it('refuses an engine key that names no workspace', async () => {
        const response = await POST(searchRequest({ token: 'stolen' }))

        expect(response.status).toBe(401)
        expect(searchTheWeb).not.toHaveBeenCalled()
    })

    it('refuses a body that is not JSON, or carries no query', async () => {
        expect((await POST(searchRequest({ body: 'not json' }))).status).toBe(400)
        expect((await POST(searchRequest({ body: { query: '' } }))).status).toBe(400)
        expect((await POST(searchRequest({ body: { query: 'rerun', maxResults: 21 } }))).status).toBe(400)
        expect(searchTheWeb).not.toHaveBeenCalled()
    })

    it('answers 503 and records nothing when no search key is configured', async () => {
        vi.mocked(searchTheWeb).mockResolvedValue(null)

        const response = await POST(searchRequest())

        expect(response.status).toBe(503)
        expect(insert).not.toHaveBeenCalled()
    })

    it('returns the results and records the search under its workspace and coworker', async () => {
        const response = await POST(searchRequest())

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({ results: RESULTS })
        expect(searchTheWeb).toHaveBeenCalledWith('rerun', 20)
        expect(from).toHaveBeenCalledWith('web_search_events')
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: WORKSPACE_ID, engine_agent_id: 'surfer', query: 'rerun', outcome: 'ok', result_count: 1, provider_status: 200, cached: false }))
    })

    it('records a search that found nothing as empty', async () => {
        vi.mocked(searchTheWeb).mockResolvedValue({ status: 200, ok: true, results: [] })

        const response = await POST(searchRequest())

        await expect(response.json()).resolves.toEqual({ results: [] })
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'empty', result_count: 0 }))
    })

    it('answers 502 and records the status when the provider fails', async () => {
        vi.mocked(searchTheWeb).mockResolvedValue({ status: 429, ok: false, results: [] })

        const response = await POST(searchRequest())

        expect(response.status).toBe(502)
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error', provider_status: 429 }))
    })

    it('still returns the results when the search cannot be recorded', async () => {
        insert.mockResolvedValue({ error: { message: 'relation does not exist' } })
        expect((await POST(searchRequest())).status).toBe(200)

        insert.mockRejectedValue(new Error('network'))
        const response = await POST(searchRequest())

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({ results: RESULTS })
    })

    it('asks the provider for a full page, keeps it, and returns only what was asked', async () => {
        vi.mocked(searchTheWeb).mockResolvedValue({ status: 200, ok: true, results: PAGE })

        const response = await POST(searchRequest({ body: { query: '  Rerun  AI ', maxResults: 3 } }))

        await expect(response.json()).resolves.toEqual({ results: PAGE.slice(0, 3) })
        expect(readCachedSearch).toHaveBeenCalledWith('rerun ai')
        expect(storeSearch).toHaveBeenCalledWith('rerun ai', PAGE)
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ result_count: 3, cached: false }))
    })

    it('answers a query already searched from the cache, without paying the provider', async () => {
        vi.mocked(readCachedSearch).mockResolvedValue(PAGE)

        const response = await POST(searchRequest({ body: { query: 'rerun', maxResults: 5 } }))

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({ results: PAGE.slice(0, 5) })
        expect(searchTheWeb).not.toHaveBeenCalled()
        expect(storeSearch).not.toHaveBeenCalled()
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: WORKSPACE_ID, outcome: 'ok', result_count: 5, provider_status: null, cached: true }))
    })

    it('answers from the cache even when no search key is configured', async () => {
        vi.mocked(readCachedSearch).mockResolvedValue(RESULTS)
        vi.mocked(searchTheWeb).mockResolvedValue(null)

        const response = await POST(searchRequest())

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({ results: RESULTS })
    })

    it('keeps neither a failed nor an empty search', async () => {
        vi.mocked(searchTheWeb).mockResolvedValue({ status: 429, ok: false, results: [] })
        await POST(searchRequest())

        vi.mocked(searchTheWeb).mockResolvedValue({ status: 200, ok: true, results: [] })
        await POST(searchRequest())

        expect(storeSearch).not.toHaveBeenCalled()
    })
})
