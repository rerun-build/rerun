import { estimatePaidDataProviderCost, paidDataEstimateSchema } from '@rerun/contracts'
import { ensureCurrentPeriod, getWorkspaceBudgetByEngineKey, RERUN_CREDIT_PAUSED_ERROR, remainingMicros } from '@/ee/services/rerunBudget.service'
import { paidDataPriceMultiplier } from '@/lib/paid-data/pricing'

// What a planned batch of paid data calls should cost the workspace, at the hub's current price
// multiplier, next to the credit it has left. The coworker shows it to the user before asking to
// spend it.
export const dynamic = 'force-dynamic'

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

    const parsed = paidDataEstimateSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })

    const resolved = await getWorkspaceBudgetByEngineKey(token)
    if (!resolved) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (resolved.paused) return Response.json({ error: RERUN_CREDIT_PAUSED_ERROR }, { status: 402 })

    const budget = await ensureCurrentPeriod(resolved)
    const estimate = estimatePaidDataProviderCost(parsed.data, paidDataPriceMultiplier())
    return Response.json({ ...estimate, remainingMicros: remainingMicros(budget) })
}
