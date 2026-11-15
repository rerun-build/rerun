import { runApifyActorWithCost } from '@/lib/experts/apify'
import { linkedinUsername, type RawLinkedinProfile } from '@/lib/experts/linkedin-scrape'
import type { SearchFindings } from './search'
import type { SiteFindings } from './site'
import { mentionsName } from './social'
import { CollectorSkipped, type Collector, type ExploreInput } from './types'

const DEFAULT_ACTOR = 'apimaestro/linkedin-profile-detail'

export type ProfileSource = 'input' | 'site' | 'search'

export type LinkedinPersonFindings = { url: string; source: ProfileSource; profile: RawLinkedinProfile }

export function findPersonProfile(input: ExploreInput, site: SiteFindings | null, search: SearchFindings | null): { url: string; source: ProfileSource } | null {
    if (input.linkedinUrl) return { url: input.linkedinUrl, source: 'input' }
    const name = input.personName
    if (!name) return null

    const onSite = site?.linkedinPeople.find(url => mentionsName(linkedinUsername(url), name))
    if (onSite) return { url: onSite, source: 'site' }

    const found = search?.queries
        .find(query => query.kind === 'person')
        ?.results.find(result => /linkedin\.com\/in\//i.test(result.url) && mentionsName(result.title, name))
    return found ? { url: found.url, source: 'search' } : null
}

type ExperienceEntry = { title?: string; company?: string }

export const linkedinPersonCollector: Collector<'linkedinPerson'> = {
    id: 'linkedinPerson',
    needs: ['site', 'search'],
    async run({ input, need }) {
        const [site, search] = await Promise.all([need('site'), need('search')])
        const target = findPersonProfile(input, site, search)
        if (!target) throw new CollectorSkipped(input.personName ? `Aucun profil LinkedIn trouvé pour ${input.personName}` : 'Ni URL LinkedIn ni nom saisi')

        const actor = process.env.APIFY_LINKEDIN_ACTOR ?? DEFAULT_ACTOR
        const { items, usd } = await runApifyActorWithCost<RawLinkedinProfile>(actor, { username: linkedinUsername(target.url), includeEmail: false }, { limit: 1 })
        const profile = items[0]
        if (!profile) throw new Error('Apify returned no profile data')

        const current = (Array.isArray(profile.experience) ? (profile.experience as ExperienceEntry[]) : [])[0]
        return {
            data: { ...target, profile },
            cost: { usd },
            highlights: [
                `${profile.basic_info?.fullname ?? '?'}, trouvé via ${target.source}`,
                profile.basic_info?.headline ?? 'Pas de headline',
                current ? `Poste actuel : ${current.title ?? '?'} chez ${current.company ?? '?'}` : 'Pas d’expérience listée',
                profile.basic_info?.location?.full ?? 'Lieu inconnu',
            ],
        }
    },
}
