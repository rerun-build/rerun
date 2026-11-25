import 'server-only'

import { ensureWorkspaceNamed } from '@/app/api/_services/naming.service'
import { requestCompanyBrainSeed, requestCompanyExplore } from '@/lib/brain/request-seed'
import type { CompanyProfile } from '@/lib/company/analyze'
import { companySiteUrl } from '@/lib/company/firecrawl'
import { analyzeCompanyProfile } from '@/lib/company/profile'
import { readAnswers, writeAnswers } from '@/lib/foreman/profile'
import type { ForemanAnswers } from '@/lib/foreman/phase'
import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isTemplateCategory, platformHost, type TemplateCategory } from '@rerun/contracts'

// A read started while the address was being typed is usually done by the time it is sent. One that
// is not gets this long before the address is kept alone: nobody waits on a slow site.
const SITE_READ_BUDGET_MS = 12_000

const withinBudget = <T>(work: Promise<T>, fallback: T): Promise<T> => Promise.race([work, new Promise<T>(resolve => setTimeout(() => resolve(fallback), SITE_READ_BUDGET_MS))])

export type CompanySite = { url: string; profile: CompanyProfile | null; industry: TemplateCategory | null }

/** A company's own site and what it says of it, or `null` for a platform's address or what is no address at all. */
export async function readCompanySite(input: string): Promise<CompanySite | null> {
    const url = platformHost(input) ? null : companySiteUrl(input)
    if (!url) return null
    const analysis = await withinBudget(analyzeCompanyProfile(url), null)
    if (!analysis?.ok) return { url, profile: null, industry: null }
    const { profile } = analysis.analysis
    return { url: analysis.analysis.url, profile, industry: profile.industry && isTemplateCategory(profile.industry) ? profile.industry : null }
}

function withCompanySite(answers: ForemanAnswers, site: CompanySite): ForemanAnswers {
    return {
        ...answers,
        company_url: site.url,
        company_name: site.profile?.name ?? undefined,
        company_description: site.profile?.description ?? undefined,
        company_offering: site.profile?.offering ?? undefined,
        company_audience: site.profile?.audience ?? undefined,
        onboarding: { ...answers.onboarding, siteSkipped: false, siteIndustry: site.industry ?? undefined },
    }
}

type SiteScope = { supabase: SupabaseClient<Database>; workspaceId: number; userId: string }

// Given once the workspace runs: the seed its machine started on found no site to read, so the Brain
// is asked for again, and the name it took from a first name gives way to the company's. What they
// said themselves is never a guess: their line of work stays, and so does what they sell until the
// site says better.
export async function saveCompanySite({ supabase, workspaceId, userId }: SiteScope, site: CompanySite): Promise<ForemanAnswers> {
    const scope = { supabase, workspace: { id: workspaceId } }
    const before = await readAnswers(scope)
    const read = withCompanySite(before, site)
    const answers: ForemanAnswers = { ...read, company_offering: read.company_offering ?? before.company_offering, industry: before.industry ?? site.industry ?? undefined }
    await writeAnswers(scope, answers, false)
    await requestCompanyExplore(supabase, workspaceId, site.url).catch(err => console.error('Failed to request a company exploration', workspaceId, err))
    await requestCompanyBrainSeed(workspaceId, `brain-seed-${workspaceId}-${site.url}`)
    await ensureWorkspaceNamed({ workspaceId, userId, overFirstName: true })
    return answers
}

export async function skipCompanySite({ supabase, workspaceId }: Omit<SiteScope, 'userId'>): Promise<ForemanAnswers> {
    const scope = { supabase, workspace: { id: workspaceId } }
    const answers = await readAnswers(scope)
    const skipped: ForemanAnswers = { ...answers, onboarding: { ...answers.onboarding, siteSkipped: true } }
    await writeAnswers(scope, skipped, false)
    return skipped
}
