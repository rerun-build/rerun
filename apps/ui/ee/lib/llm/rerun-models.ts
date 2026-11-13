import { RERUN_MODELS, RERUN_TIERS, type RerunUpstreamModels } from '@rerun/contracts'
import { RERUN_UPSTREAM_MODELS } from '@/lib/engine/constants'
import { getWorkspaceBudgetByEngineKey } from '@/ee/services/rerunBudget.service'

// The same resolution as the proxy, for the box that asks.
export async function GET(req: Request) {
    const header = req.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const resolved = token ? await getWorkspaceBudgetByEngineKey(token) : null
    if (!resolved) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const models = Object.fromEntries(RERUN_TIERS.map(tier => [RERUN_MODELS[tier], RERUN_UPSTREAM_MODELS[tier]]))
    return Response.json({ models } satisfies RerunUpstreamModels)
}
