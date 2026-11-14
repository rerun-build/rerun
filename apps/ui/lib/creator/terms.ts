import { landingUrl } from '@/lib/site'

export type CreatorTermId = 'terms' | 'cadence' | 'quality' | 'sandbox'

export type CreatorTerm = {
    id: CreatorTermId
    href?: string
}

export const CREATOR_TERMS: readonly CreatorTerm[] = [{ id: 'terms', href: landingUrl('/marketplace-terms') }, { id: 'cadence' }, { id: 'quality' }, { id: 'sandbox' }]
