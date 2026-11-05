import { RERUN_MODELS, RERUN_TIERS, rerunTierOf, withAnthropicCacheBreakpoints, type RerunUpstreamModels } from '@rerun/contracts'

import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { RERUN_TIER_REASONING, RERUN_UPSTREAM_MODELS } from '@/lib/engine/constants'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const ANTHROPIC_PROVIDER = { provider: { order: ['anthropic'] } }

// The Rerun models of a self-hosted install run on its own OpenRouter key (OPENROUTER_API_KEY):
// the same tiers as Rerun Cloud, with no credit to count. A box the app does not know is refused,
// so the key never serves anybody else.
async function knownBox(req: Request): Promise<boolean> {
    const header = req.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    return !!token && !!(await authenticateEngineToken(token))
}

export async function rerunChatCompletions(req: Request): Promise<Response> {
    if (!(await knownBox(req))) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const key = process.env.OPENROUTER_API_KEY
    // The OpenAI error shape is what the engine's SDK reads the sentence out of, and a 403 is neither
    // retried nor taken for an overloaded provider: the chat shows the sentence itself.
    if (!key) return Response.json({ error: { message: 'Set OPENROUTER_API_KEY to run the Rerun models, or connect another AI provider in the app.', code: 'rerun_models_not_configured' } }, { status: 403 })

    let body: Record<string, unknown>
    try {
        body = (await req.json()) as Record<string, unknown>
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const tier = rerunTierOf(body.model)
    const model = RERUN_UPSTREAM_MODELS[tier]
    const reasoning = RERUN_TIER_REASONING[tier]
    const upstream = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ ...(model.startsWith('anthropic/') ? { ...withAnthropicCacheBreakpoints(body), ...ANTHROPIC_PROVIDER } : body), model, ...(reasoning ? { reasoning } : {}) }),
        signal: body.stream === true ? req.signal : undefined,
    })
    if (!upstream.ok) console.error('[llm] upstream refused', { status: upstream.status, model, body: (await upstream.clone().text().catch(() => '')).slice(0, 2000) })
    // fetch has already decompressed the body: passing its headers on would announce a gzip body
    // that no longer is one, and every call that does not stream would fail to parse it.
    return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' } })
}

export async function rerunModels(req: Request): Promise<Response> {
    if (!(await knownBox(req))) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const models = Object.fromEntries(RERUN_TIERS.map(tier => [RERUN_MODELS[tier], RERUN_UPSTREAM_MODELS[tier]]))
    return Response.json({ models } satisfies RerunUpstreamModels)
}
