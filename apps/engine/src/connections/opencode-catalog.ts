import { OPENCODE_CATALOG_URL, OPENCODE_PLANS, OPENCODE_SNAPSHOT, parseOpencodeCatalog, toProviderModel, type OpencodeModel, type OpencodePlan, type ProviderModel } from '@rerun/contracts'
import { logger } from '../lib/logger.js'
import { opencodeUserAgent } from '../runtime/build-info.js'

const FETCH_TIMEOUT_MS = 10_000
const STALE_AFTER_MS = 30 * 60_000

type Reading = { models: OpencodeModel[]; at: number }
const readings = new Map<OpencodePlan, Reading>()
let attemptedAt = 0
let inFlight: Promise<void> | null = null

async function fetchPlan(plan: OpencodePlan): Promise<OpencodeModel[] | null> {
    const response = await fetch(OPENCODE_CATALOG_URL[plan], { headers: { 'User-Agent': opencodeUserAgent() }, redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) return null
    const models = parseOpencodeCatalog(await response.json(), plan)
    return models.length ? models : null
}

export function refreshOpencodeCatalog(): Promise<void> {
    if (inFlight) return inFlight
    attemptedAt = Date.now()
    inFlight = Promise.all(
        OPENCODE_PLANS.map(async plan => {
            const models = await fetchPlan(plan).catch(err => {
                logger.warn({ plan, err: String(err) }, 'opencode catalog read failed')
                return null
            })
            if (models) readings.set(plan, { models, at: Date.now() })
        }),
    )
        .then(() => undefined)
        .finally(() => {
            inFlight = null
        })
    return inFlight
}

export function refreshStaleOpencodeCatalog(): void {
    if (Date.now() - attemptedAt < STALE_AFTER_MS) return
    void refreshOpencodeCatalog()
}

function modelsOf(plan: OpencodePlan): OpencodeModel[] {
    return readings.get(plan)?.models ?? OPENCODE_SNAPSHOT.filter(model => model.plan === plan)
}

export function opencodeModel(id: string): OpencodeModel | undefined {
    for (const plan of OPENCODE_PLANS) {
        if (!id.startsWith(`${plan}/`)) continue
        return modelsOf(plan).find(model => model.id === id) ?? OPENCODE_SNAPSHOT.find(model => model.id === id)
    }
    return undefined
}

export function opencodeModels(): OpencodeModel[] {
    return OPENCODE_PLANS.flatMap(modelsOf)
}

export function opencodeProviderModels(): ProviderModel[] {
    return opencodeModels().map(toProviderModel)
}

export function liveOpencodeProviderModels(): ProviderModel[] | null {
    if (!OPENCODE_PLANS.every(plan => readings.has(plan))) return null
    return opencodeModels().map(toProviderModel)
}

export function forceOpencodeCatalogRefresh(): void {
    void refreshOpencodeCatalog()
}

export function resetOpencodeCatalogForTests(): void {
    readings.clear()
    attemptedAt = 0
    inFlight = null
}
