import { after } from 'next/server'
import { rerunTierOf, withAnthropicCacheBreakpoints } from '@rerun/contracts'
import { RERUN_TIER_REASONING, RERUN_UPSTREAM_MODELS } from '@/lib/engine/constants'
import { MICROS_PER_USD } from '@/ee/lib/billing/plans'
import { meteredFetch, type OpenRouterUsage } from '@/ee/lib/billing/openrouter-usage'
import { notifyBudgetExhausted } from '@/ee/services/budgetNotification.service'
import { ensureCurrentPeriod, getWorkspaceBudgetByEngineKey, hasRemainingBudget, RERUN_CREDIT_PAUSED_ERROR, recordRerunUsage } from '@/ee/services/rerunBudget.service'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// An OpenAI model on OpenRouter caches its prompt on its own, an Anthropic one only when asked, and
// the boxes cannot ask on the `rerun` provider: they do not know what model a tier runs. The
// rewrite marks each system block the box sent and the prefix up to the last message, so each step
// of a run reads what the one before it wrote; pinning Anthropic keeps that step on the provider
// holding the cache.
const ANTHROPIC_PROVIDER = { provider: { order: ['anthropic'] } }

export async function POST(req: Request) {
    const header = req.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    // The Rerun models spend their own OpenRouter key, apart from the hub's internal one (transcription,
    // re-rank, company analysis) and from the embedding one: it is the only key a signed-up user
    // can reach, so an abusive workspace drains it alone.
    const demoKey = process.env.RERUN_MAX_API_KEY
    if (!demoKey) return Response.json({ error: 'Demo models unavailable' }, { status: 503 })

    // Nothing bounds this body (the route sits outside the proxy's size cap, images travel inline),
    // so only a box the hub knows gets it read.
    const resolved = await getWorkspaceBudgetByEngineKey(token)
    if (!resolved) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    let body: Record<string, unknown>
    try {
        body = (await req.json()) as Record<string, unknown>
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    // The box names an alias, the hub says what it resolves to. Rewriting rather than refusing an
    // unknown id is what lets a box that has not self-updated keep running the current model, and
    // it is the guard on the shared key too: nothing else can be asked for on it.
    const tier = rerunTierOf(body.model)
    const model = RERUN_UPSTREAM_MODELS[tier]
    const reasoning = RERUN_TIER_REASONING[tier]

    if (resolved.paused) return Response.json({ error: RERUN_CREDIT_PAUSED_ERROR }, { status: 402 })

    const budget = await ensureCurrentPeriod(resolved)
    if (!hasRemainingBudget(budget)) {
        after(() => notifyBudgetExhausted(budget.workspaceId))
        return Response.json({ error: 'rerun_budget_exhausted' }, { status: 402 })
    }

    const engineAgentId = req.headers.get('x-rerun-agent')
    const settle = (usage: OpenRouterUsage) => {
        if (typeof usage.cost !== 'number') return
        void recordRerunUsage({
            workspaceId: budget.workspaceId,
            engineAgentId,
            model,
            tier,
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
            costMicros: Math.round(usage.cost * MICROS_PER_USD),
        }).catch(() => {})
    }

    // The wrapper asks OpenRouter for the real credit cost and reads it back from the last frame,
    // so we decrement exactly what we pay. It passes every byte through untouched.
    //
    // A box that hangs up stops a streaming generation, and its bill, upstream. A non-streaming one
    // runs to the end and is billed in full whatever we do, so its answer is left to arrive: aborting
    // it would only lose the usage frame `settle` needs.
    const upstream = await meteredFetch(settle)(OPENROUTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${demoKey}` },
        body: JSON.stringify({ ...(model.startsWith('anthropic/') ? { ...withAnthropicCacheBreakpoints(body), ...ANTHROPIC_PROVIDER } : body), model, ...(reasoning ? { reasoning } : {}) }),
        signal: body.stream === true ? req.signal : undefined,
    })
    if (!upstream.ok) after(() => logUpstreamRefusal(upstream.clone(), { workspaceId: budget.workspaceId, engineAgentId, model }))
    return upstream
}

// The box only keeps OpenRouter's top-level message, "Provider returned error", while the reason the
// model provider gave sits in the body (`error.metadata.raw`). Without this line a refusal that
// repeats on every retry of a conversation leaves nothing to go on.
async function logUpstreamRefusal(response: Response, context: { workspaceId: number; engineAgentId: string | null; model: string }): Promise<void> {
    const body = await response.text().catch(() => '')
    console.error('[llm] upstream refused', { status: response.status, ...context, body: body.slice(0, 2000) })
}
