import { OPENCODE_CATALOG_URL, OPENCODE_PLANS, OPENCODE_SNAPSHOT, parseOpencodeCatalog, toProviderModel, type OpencodeModel, type OpencodePlan, type ProviderModel } from '@rerun/contracts'
import { logger } from '../lib/logger.js'
import { opencodeUserAgent } from '../runtime/build-info.js'

const FETCH_TIMEOUT_MS = 10_000
const STALE_AFTER_MS = 30 * 60_000

// One reading for the whole box, in memory like the CLI model lists: the catalog is public, the
// same for every key, and the next boot reads it again.
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

// A plan that cannot be read keeps its previous reading: a catalog that answered once is a better
// guess than the snapshot, and the snapshot a better one than nothing.
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

// Paced on the last attempt, so a catalog that cannot be reached is not asked again on every list.
export function refreshStaleOpencodeCatalog(): void {
    if (Date.now() - attemptedAt < STALE_AFTER_MS) return
    void refreshOpencodeCatalog()
}

function modelsOf(plan: OpencodePlan): OpencodeModel[] {
    return readings.get(plan)?.models ?? OPENCODE_SNAPSHOT.filter(model => model.plan === plan)
}

// Synchronous on purpose: `resolveModel` is. The live reading first, the snapshot this build was
// cut with otherwise.
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

// What the hub lists for an OpenCode connection.
export function opencodeProviderModels(): ProviderModel[] {
    return opencodeModels().map(toProviderModel)
}

// Only a live reading may say a model is gone: the snapshot cannot know what was retired since.
export function liveOpencodeProviderModels(): ProviderModel[] | null {
    if (!OPENCODE_PLANS.every(plan => readings.has(plan))) return null
    return opencodeModels().map(toProviderModel)
}

// The answer to an unsupported model is a reason to read the catalog again right away.
export function forceOpencodeCatalogRefresh(): void {
    void refreshOpencodeCatalog()
}

export function resetOpencodeCatalogForTests(): void {
    readings.clear()
    attemptedAt = 0
    inFlight = null
}
