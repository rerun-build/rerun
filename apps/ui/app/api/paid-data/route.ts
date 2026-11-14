import { after } from 'next/server'
import { z } from 'zod'
import { isPaidDataCapability, legacyPaidDataCapability, PAID_DATA_FULL_ANSWER_HEADER, PAID_DATA_ROUTE_MAX_COST_ERROR, PAID_DATA_TOOL, parsePaidDataParams } from '@rerun/contracts'
import { notifyBudgetExhausted } from '@/ee/services/budgetNotification.service'
import { ensureCurrentPeriod, getWorkspaceBudgetByEngineKey, hasRemainingBudget, RERUN_CREDIT_PAUSED_ERROR, recordPaidDataUsage } from '@/ee/services/rerunBudget.service'
import { BILLING_ENABLED } from '@rerun/cloud/billing'
import { billedMicros, paidDataPriceMultiplier } from '@/lib/paid-data/pricing'
import { callTregCapability, type TregCall, type TregFullAnswer } from '@/lib/paid-data/treg'

export const dynamic = 'force-dynamic'

const MAX_RAW_CHARS = 15_000_000

const ROUTE_MAX_COST_MESSAGE = 'no source answered this at the catalog price: the ones within it found nothing, and the next one charges more than the catalog says. Do not retry the same lookup; narrow the inputs (a company domain, a title) or move on'

const bodySchema = z.object({ capability: z.string().optional(), tool: z.string().optional(), params: z.record(z.string(), z.unknown()).default({}) })

function bearerToken(req: Request): string {
    const header = req.headers.get('authorization') ?? ''
    return header.startsWith('Bearer ') ? header.slice(7) : ''
}

export async function GET(req: Request): Promise<Response> {
    const token = bearerToken(req)
    if (!token || !(await getWorkspaceBudgetByEngineKey(token))) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    return Response.json({ enabled: BILLING_ENABLED, priceMultiplier: paidDataPriceMultiplier() })
}

export async function POST(req: Request): Promise<Response> {
    const token = bearerToken(req)
    if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const resolved = await getWorkspaceBudgetByEngineKey(token)
    if (!resolved) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    let body: unknown
    try {
        body = await req.json()
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
    const capability = parsed.data.capability ?? legacyPaidDataCapability(parsed.data.tool ?? '')
    if (!isPaidDataCapability(capability)) return Response.json({ error: `Unknown paid data capability: ${parsed.data.capability ?? parsed.data.tool}` }, { status: 400 })

    const params = parsePaidDataParams(capability, parsed.data.params)
    if (!params.ok) return Response.json({ error: params.error }, { status: 400 })

    if (resolved.paused) return Response.json({ error: RERUN_CREDIT_PAUSED_ERROR }, { status: 402 })

    const budget = await ensureCurrentPeriod(resolved)
    if (!hasRemainingBudget(budget)) {
        after(() => notifyBudgetExhausted(budget.workspaceId))
        return Response.json({ error: 'rerun_budget_exhausted' }, { status: 402 })
    }

    const engineAgentId = req.headers.get('x-rerun-agent')
    const startedAt = Date.now()
    const wantsFull = req.headers.get(PAID_DATA_FULL_ANSWER_HEADER) === '1'
    const call = await callTregCapability(capability, params.params, { workspaceId: budget.workspaceId, agentId: engineAgentId }, { full: wantsFull })
    if (!call) return Response.json({ error: 'Paid data is not configured' }, { status: 503 })

    const billed = billedMicros(call.costMicros)
    try {
        await recordPaidDataUsage({
            workspace_id: budget.workspaceId,
            engine_agent_id: engineAgentId,
            tool: PAID_DATA_TOOL,
            capability: `treg.${capability}`,
            served_by: call.servedBy,
            outcome: call.outcome,
            provider_cost_micros: call.costMicros,
            billed_micros: billed,
            treg_status: call.status,
            treg_call_id: call.callId,
            duration_ms: Date.now() - startedAt,
        })
    } catch (err) {
        console.error('[paid-data] could not bill the call:', call.callId, err instanceof Error ? err.message : err)
    }

    if (call.status === 402 && call.errorCode !== PAID_DATA_ROUTE_MAX_COST_ERROR) {
        console.error('[paid-data] the Treg balance is exhausted, every paid data call fails until it is topped up')
        return Response.json({ error: 'Paid data is temporarily unavailable' }, { status: 503 })
    }
    if (call.errorCode === PAID_DATA_ROUTE_MAX_COST_ERROR) return Response.json({ error: ROUTE_MAX_COST_MESSAGE, costMicros: 0 }, { status: 422 })
    if (isProviderUnavailable(call) && billed === 0) {
        console.warn('[paid-data] the data provider is unavailable:', call.status ?? 'unreachable', call.callId, call.error)
        return Response.json({ error: 'Paid data is temporarily unavailable', costMicros: 0 }, { status: 503 })
    }
    if (call.outcome === 'error') return Response.json({ error: call.error ?? 'The data provider failed', costMicros: billed }, { status: call.status && call.status < 500 ? 422 : 502 })

    const saved = wantsFull ? { callId: call.callId, full: capRaw(call.full) } : {}
    return Response.json({ outcome: call.outcome, result: call.result, costMicros: billed, servedBy: call.servedBy, ...saved })
}

function isProviderUnavailable(call: TregCall): boolean {
    return call.outcome === 'error' && (call.status === null || call.status === 429 || call.status >= 500)
}

function capRaw(full: TregFullAnswer | null): (TregFullAnswer & { rawDropped?: true }) | null {
    if (!full || (JSON.stringify(full.raw)?.length ?? 0) <= MAX_RAW_CHARS) return full
    return { ...full, raw: null, rawDropped: true }
}
