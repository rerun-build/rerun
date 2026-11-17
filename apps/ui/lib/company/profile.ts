import { analyzeCompany, type CompanyAnalysis } from './analyze'
import { companySiteUrl, scrapeCompanySite } from './firecrawl'

// A scrape plus a model call per site, so a back-and-forth through the onboarding does not pay for
// the same page twice. Process-local and short lived: this is a cost guard, not a store.
const CACHE_TTL_MS = 15 * 60 * 1000
const cache = new Map<string, { at: number; analysis: CompanyAnalysis }>()

// Reads the company website given during onboarding. Failure is a normal outcome here: the answer
// is optional, the site may block crawlers, and the conversation carries on either way, so the
// caller only ever needs to know whether a profile came back.
//
// Kept out of the server action so the foreman route can reach it: a route handler calling a
// `'use server'` export would be invoking an action endpoint from inside the server.
export async function analyzeCompanyProfile(input: string): Promise<{ ok: true; analysis: CompanyAnalysis } | { ok: false; error: string }> {
    const url = companySiteUrl(input)
    if (!url) return { ok: false, error: 'That does not look like a website address' }

    const hit = cache.get(url)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ok: true, analysis: hit.analysis }

    // The board starts the read while the site is being typed, and the welcome page waits on the
    // same one when the answer is sent: the second caller joins the read under way.
    const running = inflight.get(url)
    if (running) return running
    const read = readCompanyProfile(url).finally(() => inflight.delete(url))
    inflight.set(url, read)
    return read
}

const inflight = new Map<string, Promise<{ ok: true; analysis: CompanyAnalysis } | { ok: false; error: string }>>()

async function readCompanyProfile(url: string): Promise<{ ok: true; analysis: CompanyAnalysis } | { ok: false; error: string }> {
    const markdown = await scrapeCompanySite(url)
    if (!markdown) return { ok: false, error: 'We could not read that website' }

    const profile = await analyzeCompany(markdown, new URL(url).hostname)
    if (!profile) return { ok: false, error: 'We could not make sense of that website' }

    const analysis: CompanyAnalysis = { url, profile }
    cache.set(url, { at: Date.now(), analysis })
    return { ok: true, analysis }
}
