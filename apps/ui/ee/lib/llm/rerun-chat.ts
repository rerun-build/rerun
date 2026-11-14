import { after } from 'next/server'
import { rerunTierOf, withAnthropicCacheBreakpoints } from '@rerun/contracts'
import { RERUN_TIER_REASONING, RERUN_UPSTREAM_MODELS, servedRerunTier } from '@/lib/engine/constants'
import { MICROS_PER_USD } from '@/ee/lib/billing/plans'
import { meteredFetch, type OpenRouterUsage } from '@/ee/lib/billing/openrouter-usage'
import { notifyBudgetExhausted } from '@/ee/services/budgetNotification.service'
import { ensureCurrentPeriod, getWorkspaceBudgetByEngineKey, hasRemainingBudget, RERUN_CREDIT_PAUSED_ERROR, recordRerunUsage } from '@/ee/services/rerunBudget.service'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const ANTHROPIC_PROVIDER = { provider: { order: ['anthropic'] } }

export async function POST(req: Request) {
    const header = req.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const demoKey = process.env.RERUN_MAX_API_KEY
    if (!demoKey) return Response.json({ error: 'Demo models unavailable' }, { status: 503 })

    const resolved = await getWorkspaceBudgetByEngineKey(token)
    if (!resolved) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    let body: Record<string, unknown>
    try {
        body = (await req.json()) as Record<string, unknown>
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const tier = servedRerunTier(rerunTierOf(body.model), resolved.smartAllowed)
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

    const upstream = await meteredFetch(settle)(OPENROUTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${demoKey}` },
        body: JSON.stringify({ ...(model.startsWith('anthropic/') ? { ...withAnthropicCacheBreakpoints(body), ...ANTHROPIC_PROVIDER } : body), model, ...(reasoning ? { reasoning } : {}) }),
        signal: body.stream === true ? req.signal : undefined,
    })
    if (!upstream.ok) after(() => logUpstreamRefusal(upstream.clone(), { workspaceId: budget.workspaceId, engineAgentId, model }))
    return upstream
}

async function logUpstreamRefusal(response: Response, context: { workspaceId: number; engineAgentId: string | null; model: string }): Promise<void> {
    const body = await response.text().catch(() => '')
    console.error('[llm] upstream refused', { status: response.status, ...context, body: body.slice(0, 2000) })
}
