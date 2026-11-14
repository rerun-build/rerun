import { COLLECTOR_IDS, type CollectorId } from './catalog'
import { catalogCollector } from './catalog-collector'
import { dnsCollector } from './dns'
import { googleBusinessCollector } from './google-business'
import { linkedinCompanyCollector } from './linkedin-company'
import { linkedinPersonCollector } from './linkedin-person'
import { registryCollector } from './registry'
import { searchCollector } from './search'
import { siteCollector } from './site'
import { stackCollector } from './stack'
import { synthesisCollector } from './synthesize'
import { CollectorSkipped, type Collector, type CollectorContext, type CollectorData, type CollectorOutput, type ExploreInput } from './types'

export type ExploreEvent =
    | { type: 'running'; id: CollectorId }
    | { type: 'done'; id: CollectorId; durationMs: number; output: CollectorOutput<unknown> }
    | { type: 'error'; id: CollectorId; durationMs: number; error: string }
    | { type: 'skipped'; id: CollectorId; reason: string }
    | { type: 'end'; durationMs: number }

const COLLECTORS: { [K in CollectorId]: Collector<K> } = {
    dns: dnsCollector,
    stack: stackCollector,
    site: siteCollector,
    search: searchCollector,
    registry: registryCollector,
    linkedinPerson: linkedinPersonCollector,
    linkedinCompany: linkedinCompanyCollector,
    googleBusiness: googleBusinessCollector,
    catalog: catalogCollector,
    synthesis: synthesisCollector,
}

const COLLECTOR_TIMEOUT_MS = 240_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Gave up after ${ms / 1000} s`)), ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function exploreCompany(input: ExploreInput, enabled: ReadonlySet<CollectorId>, emit: (event: ExploreEvent) => void): Promise<void> {
    const startedAt = Date.now()
    const results = new Map<CollectorId, Promise<unknown>>()

    const context: CollectorContext = {
        input,
        need: <K extends CollectorId>(id: K) => results.get(id) as Promise<CollectorData[K] | null>,
    }

    const run = async <K extends CollectorId>(collector: Collector<K>): Promise<CollectorData[K] | null> => {
        if (!enabled.has(collector.id)) {
            emit({ type: 'skipped', id: collector.id, reason: 'Désactivé' })
            return null
        }
        await Promise.all(collector.needs.map(id => results.get(id)))
        emit({ type: 'running', id: collector.id })
        const collectorStartedAt = Date.now()
        try {
            const output = await withTimeout(collector.run(context), COLLECTOR_TIMEOUT_MS)
            emit({ type: 'done', id: collector.id, durationMs: Date.now() - collectorStartedAt, output })
            return output.data
        } catch (error) {
            if (error instanceof CollectorSkipped) emit({ type: 'skipped', id: collector.id, reason: error.message })
            else emit({ type: 'error', id: collector.id, durationMs: Date.now() - collectorStartedAt, error: error instanceof Error ? error.message : String(error) })
            return null
        }
    }

    for (const id of COLLECTOR_IDS) results.set(id, Promise.resolve().then(() => run(COLLECTORS[id] as Collector<typeof id>)))

    await Promise.all(results.values())
    emit({ type: 'end', durationMs: Date.now() - startedAt })
}
