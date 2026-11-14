import { runApifyActorWithCost } from '@/lib/experts/apify'
import { companyNameGuess } from './company-name'
import { pointsToDomain, socialProfiles } from './social'
import { CollectorSkipped, type Collector } from './types'

const DEFAULT_ACTOR = 'harvestapi/linkedin-company'

export type RawLinkedinCompany = Record<string, unknown> & {
    name?: string
    linkedinUrl?: string
    website?: string
    logo?: string
    employeeCount?: number
    followerCount?: number
    description?: string
    specialities?: string[]
    industries?: { name?: string }[]
    locations?: { city?: string; country?: string; headquarter?: boolean }[]
}

export type LinkedinCompanySource = 'site' | 'web' | 'name'

export type LinkedinCompanyFindings = { source: LinkedinCompanySource; query: string; matchesWebsite: boolean; company: RawLinkedinCompany }

const SOURCE_LABELS: Record<LinkedinCompanySource, string> = { site: 'le lien du site', web: 'la recherche web sur le domaine', name: 'recherche par nom' }

function trimCompany(company: RawLinkedinCompany): RawLinkedinCompany {
    const { similarOrganizations, affiliatedPages, ...rest } = company
    delete rest.logos
    delete rest.backgroundCovers
    const names = (pages: unknown) => (Array.isArray(pages) ? pages.map(page => (page as { name?: string }).name).filter(Boolean) : [])
    return { ...rest, similarOrganizations: names(similarOrganizations), affiliatedPages: names(affiliatedPages) }
}

export const linkedinCompanyCollector: Collector<'linkedinCompany'> = {
    id: 'linkedinCompany',
    needs: ['site', 'stack', 'search'],
    async run({ input, need }) {
        const [site, stack, search] = await Promise.all([need('site'), need('stack'), need('search')])
        const linkedOnSite = site?.social.linkedin ?? stack?.social.linkedin
        const citingDomain = socialProfiles(search?.queries.find(query => query.kind === 'press')?.results.map(result => result.url) ?? []).linkedin
        const pageUrl = linkedOnSite ?? citingDomain
        const source: LinkedinCompanySource = linkedOnSite ? 'site' : citingDomain ? 'web' : 'name'
        const query = pageUrl ?? companyNameGuess(input, stack, site)

        const actor = process.env.APIFY_LINKEDIN_COMPANY_ACTOR ?? DEFAULT_ACTOR
        const { items, usd } = await runApifyActorWithCost<RawLinkedinCompany>(actor, pageUrl ? { companies: [pageUrl] } : { searches: [query] }, { limit: 1 })
        if (!items[0]) throw new CollectorSkipped(`Aucune page LinkedIn pour « ${query} »`)

        const company = trimCompany(items[0])
        const matchesWebsite = pointsToDomain(company.website, input.domain)
        const headquarter = company.locations?.find(location => location.headquarter) ?? company.locations?.[0]
        return {
            data: { source, query, matchesWebsite, company },
            cost: { usd },
            highlights: [
                `${company.name ?? '?'}, trouvé via ${SOURCE_LABELS[source]}${matchesWebsite ? '' : ` · site ${company.website ?? 'absent'}, sans doute un homonyme`}`,
                `${company.employeeCount ?? '?'} employés sur LinkedIn · ${company.followerCount?.toLocaleString('fr-FR') ?? '?'} abonnés`,
                `Secteur : ${company.industries?.map(industry => industry.name).join(', ') || '?'} · siège : ${headquarter ? `${headquarter.city ?? '?'}, ${headquarter.country ?? '?'}` : '?'}`,
                company.specialities?.length ? `Spécialités : ${company.specialities.slice(0, 6).join(', ')}` : 'Aucune spécialité',
            ],
        }
    },
}
