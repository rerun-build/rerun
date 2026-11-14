import { analyzeCompany, type CompanyAnalysis } from './analyze'
import { companySiteUrl, scrapeCompanySite } from './firecrawl'

const CACHE_TTL_MS = 15 * 60 * 1000
const cache = new Map<string, { at: number; analysis: CompanyAnalysis }>()

export async function analyzeCompanyProfile(input: string): Promise<{ ok: true; analysis: CompanyAnalysis } | { ok: false; error: string }> {
    const url = companySiteUrl(input)
    if (!url) return { ok: false, error: 'That does not look like a website address' }

    const hit = cache.get(url)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ok: true, analysis: hit.analysis }

    const markdown = await scrapeCompanySite(url)
    if (!markdown) return { ok: false, error: 'We could not read that website' }

    const profile = await analyzeCompany(markdown, new URL(url).hostname)
    if (!profile) return { ok: false, error: 'We could not make sense of that website' }

    const analysis: CompanyAnalysis = { url, profile }
    cache.set(url, { at: Date.now(), analysis })
    return { ok: true, analysis }
}
