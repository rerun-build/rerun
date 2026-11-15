import { resolveAgentTargetForTrigger } from '@/app/api/_services/chat.service'
import { fireTrigger } from '@/lib/engine/client'
import type { EngineTriggerMethod } from '@/lib/engine/types'
import { isPassiveVisit } from '@/lib/triggers/passive-visit'
import { MAX_TRIGGER_BODY_BYTES, readBodyCapped } from '@/lib/triggers/webhook'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const FIRE_TIMEOUT_MS = 15_000

type Params = { params: Promise<{ agentId: string; slug: string; token: string }> }

function notFound(): Response {
    return Response.json({ error: 'Not found' }, { status: 404 })
}

async function handle(req: Request, ctx: Params): Promise<Response> {
    const { agentId, slug, token } = await ctx.params
    if (!SLUG_RE.test(slug) || !token) return notFound()

    if (isPassiveVisit(req.headers)) {
        console.info(`[trigger] ${agentId}/${slug} not fired: passive visit from "${req.headers.get('user-agent') ?? 'unknown'}"`)
        return new Response(null, { status: 204 })
    }

    const raw = await readBodyCapped(req, MAX_TRIGGER_BODY_BYTES)
    if (raw === null) return Response.json({ error: 'Payload too large' }, { status: 413 })
    const bodyBytes = Buffer.byteLength(raw, 'utf8')

    const target = await resolveAgentTargetForTrigger(agentId)
    if (!target) return notFound()

    const url = new URL(req.url)
    try {
        const outcome = await fireTrigger(
            target.conn,
            target.engineAgentId,
            slug,
            {
                token,
                method: req.method as EngineTriggerMethod,
                query: url.search.replace(/^\?/, ''),
                contentType: req.headers.get('content-type') ?? '',
                body: raw,
                bodyBytes,
            },
            AbortSignal.timeout(FIRE_TIMEOUT_MS),
        )
        if (outcome.status === 405) {
            const allow = outcome.allow ?? []
            return Response.json({ error: 'Method not allowed' }, { status: 405, headers: allow.length ? { Allow: allow.join(', ') } : undefined })
        }
        if (outcome.status !== 202 || !outcome.runId) return notFound()
        return Response.json({ runId: outcome.runId, sessionId: outcome.sessionId, trigger: slug }, { status: 202 })
    } catch (err) {
        console.error(`[trigger] ${agentId}/${slug} failed:`, err instanceof Error ? err.message : err)
        return notFound()
    }
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle

export function HEAD(): Response {
    return new Response(null, { status: 200 })
}

export function OPTIONS(): Response {
    return new Response(null, { status: 204 })
}
