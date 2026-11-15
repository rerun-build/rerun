import type { CollectorId } from './catalog'
import type { CatalogFindings } from './catalog-collector'
import type { DnsFindings } from './dns'
import type { GoogleBusinessFindings } from './google-business'
import type { LinkedinCompanyFindings } from './linkedin-company'
import type { LinkedinPersonFindings } from './linkedin-person'
import type { RegistryFindings } from './registry'
import type { SearchFindings } from './search'
import type { SiteFindings } from './site'
import type { StackFindings } from './stack'
import type { SynthesisFindings } from './synthesize'

export type ExploreInput = {
    url: string
    domain: string
    personName: string | null
    email: string | null
    linkedinUrl: string | null
}

export type CollectorCost = { firecrawlCredits?: number; usd?: number; inputTokens?: number; outputTokens?: number }

export type CollectorOutput<T> = { data: T; highlights: string[]; cost?: CollectorCost }

export type CollectorData = {
    dns: DnsFindings
    stack: StackFindings
    site: SiteFindings
    search: SearchFindings
    registry: RegistryFindings
    linkedinPerson: LinkedinPersonFindings
    linkedinCompany: LinkedinCompanyFindings
    googleBusiness: GoogleBusinessFindings
    catalog: CatalogFindings
    synthesis: SynthesisFindings
}

export type CollectorContext = {
    input: ExploreInput
    need<K extends CollectorId>(id: K): Promise<CollectorData[K] | null>
}

export type Collector<K extends CollectorId> = {
    id: K
    needs: CollectorId[]
    run(ctx: CollectorContext): Promise<CollectorOutput<CollectorData[K]>>
}

export class CollectorSkipped extends Error {}
