import { landingUrl } from '@/lib/site'

// What a creator ticks before their sandbox opens. Display only: acceptance is a single timestamp
// on the fiche, so this list can be reworded freely. Changing what it *means* is a new version of
// the program, announced to the creators, not re-signed retroactively. The wording lives in
// `auth.creatorOnboarding.terms.items`.
export type CreatorTermId = 'terms' | 'cadence' | 'quality' | 'sandbox'

export type CreatorTerm = {
    id: CreatorTermId
    href?: string
}

export const CREATOR_TERMS: readonly CreatorTerm[] = [{ id: 'terms', href: landingUrl('/marketplace-terms') }, { id: 'cadence' }, { id: 'quality' }, { id: 'sandbox' }]
