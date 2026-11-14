import { z } from 'zod'
import type { Database } from '@/app/api/database.types'
import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { isPublicUrl, scrapePage } from '@/lib/company/firecrawl'
import { createServiceRoleClient } from '@/supabase/serviceRole'

export const dynamic = 'force-dynamic'

const MAX_MARKDOWN = 50_000
const MAX_RAW_HTML = 1_000_000

const bodySchema = z.object({ url: z.string().url(), directStatus: z.number().int().nullable().default(null) })

async function recordWebFetch(event: Database['public']['Tables']['web_fetch_events']['Insert']): Promise<void> {
    try {
        const { error } = await createServiceRoleClient().from('web_fetch_events').insert<Database['public']['Tables']['web_fetch_events']['Insert']>(event)
        if (error) console.error('[fetch] could not record the fetch:', error.message)
    } catch (err) {
        console.error('[fetch] could not record the fetch:', err instanceof Error ? err.message : err)
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
    if (!parsed.success || !isPublicUrl(parsed.data.url)) return Response.json({ error: 'Invalid payload' }, { status: 400 })

    const engine = await authenticateEngineToken(token)
    if (!engine) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { url, directStatus } = parsed.data
    const startedAt = Date.now()
    const page = await scrapePage(url)
    if (!page) return Response.json({ error: 'Page fetching is not configured' }, { status: 503 })

    const markdown = page.ok ? page.markdown.slice(0, MAX_MARKDOWN) : ''
    await recordWebFetch({
        workspace_id: engine.workspaceId,
        engine_agent_id: req.headers.get('x-rerun-agent'),
        url,
        host: new URL(url).hostname,
        direct_status: directStatus,
        outcome: !page.ok ? 'error' : markdown ? 'ok' : 'empty',
        provider_status: page.status,
        page_status: page.pageStatus,
        content_chars: markdown.length,
        duration_ms: Date.now() - startedAt,
    })

    if (!markdown) return Response.json({ error: 'The page could not be read' }, { status: 502 })
    return Response.json({ markdown, rawHtml: page.rawHtml.slice(0, MAX_RAW_HTML) })
}
