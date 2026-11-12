import { z } from 'zod'
import type { Database } from '@/app/api/database.types'
import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { readCachedSearch, searchCacheKey, storeSearch } from '@/lib/search/cache'
import { searchTheWeb, WEB_SEARCH_PAGE_SIZE } from '@/lib/search/web-search'
import { createServiceRoleClient } from '@/supabase/serviceRole'

// The one door a coworker's web_search goes through. The engine calls it with its RERUN_API_KEY,
// which names one workspace, so the search provider key never leaves the app.
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ query: z.string().min(1), maxResults: z.number().int().min(1).max(20).default(5) })

// Kept for diagnosis only: a search that worked is never failed by its own bookkeeping.
async function recordWebSearch(event: Database['public']['Tables']['web_search_events']['Insert']): Promise<void> {
    try {
        const { error } = await createServiceRoleClient().from('web_search_events').insert<Database['public']['Tables']['web_search_events']['Insert']>(event)
        if (error) console.error('[search] could not record the search:', error.message)
    } catch (err) {
        console.error('[search] could not record the search:', err instanceof Error ? err.message : err)
    }
}

export async function POST(req: Request): Promise<Response> {
    const header = req.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    let body: unknown
    try {
        body = await req.json()
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })

    const engine = await authenticateEngineToken(token)
    if (!engine) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { query, maxResults } = parsed.data
    const engineAgentId = req.headers.get('x-rerun-agent')
    const startedAt = Date.now()
    const key = searchCacheKey(query)

    const cached = await readCachedSearch(key)
    if (cached) {
        const results = cached.slice(0, maxResults)
        await recordWebSearch({
            workspace_id: engine.workspaceId,
            engine_agent_id: engineAgentId,
            query,
            outcome: results.length === 0 ? 'empty' : 'ok',
            result_count: results.length,
            provider_status: null,
            duration_ms: Date.now() - startedAt,
            cached: true,
        })
        return Response.json({ results })
    }

    // Always the full page, so a later search asking for more results is served from the cache too.
    const search = await searchTheWeb(query, WEB_SEARCH_PAGE_SIZE)
    if (!search) return Response.json({ error: 'Web search is not configured' }, { status: 503 })

    if (search.ok && search.results.length > 0) await storeSearch(key, search.results)

    const results = search.results.slice(0, maxResults)
    await recordWebSearch({
        workspace_id: engine.workspaceId,
        engine_agent_id: engineAgentId,
        query,
        outcome: !search.ok ? 'error' : results.length === 0 ? 'empty' : 'ok',
        result_count: results.length,
        provider_status: search.status,
        duration_ms: Date.now() - startedAt,
        cached: false,
    })

    if (!search.ok) return Response.json({ error: `The search provider failed${search.status ? ` (${search.status})` : ''}` }, { status: 502 })
    return Response.json({ results })
}
