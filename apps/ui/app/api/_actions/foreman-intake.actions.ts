'use server'

import { isTemplateCategory, type TemplateCategory } from '@rerun/contracts'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { decideIndustry } from '@/lib/company/decide-industry'
import { companySiteUrl } from '@/lib/company/firecrawl'
import { analyzeCompanyProfile } from '@/lib/company/profile'
import { mergeForeman, readAnswers, saveForemanProfile, stampWorkspaceOnboarded } from '@/lib/foreman/profile'
import { takeIntakeCall } from '@/lib/onboarding/anonymous-intake-quota'
import type { ForemanIntake } from '@/lib/onboarding/intake'

export async function decideIndustryAction(input: string): Promise<TemplateCategory | null> {
    const ctx = await requireWorkspaceContext()
    if (!takeIntakeCall(ctx.workspace.id, 'decide')) return null
    const decision = await decideIndustry(input)
    return decision?.industry ?? null
}

export async function saveForemanIntakeAction(intake: ForemanIntake): Promise<{ industry: TemplateCategory | null }> {
    const ctx = await requireWorkspaceContext()
    if (ctx.authUser.is_anonymous) throw new Error('Create your account first.')

    const url = intake.companyUrl ? companySiteUrl(intake.companyUrl) : null
    const analysis = url ? await analyzeCompanyProfile(url) : null
    const profile = analysis?.ok ? analysis.analysis.profile : null

    const industry = intake.industry ?? profile?.industry ?? intake.decidedIndustry ?? null

    await saveForemanProfile(ctx, {
        company_url: analysis?.ok ? analysis.analysis.url : (url ?? undefined),
        company_name: profile?.name,
        company_description: profile?.description,
        company_offering: profile?.offering ?? intake.industryLabel ?? undefined,
        company_audience: profile?.audience,
        industry: industry ?? undefined,
        position: intake.position ?? undefined,
        first_name: intake.firstName ?? undefined,
    })

    return { industry: industry && isTemplateCategory(industry) ? industry : null }
}

export async function waiveForemanProfileAction(): Promise<void> {
    const ctx = await requireWorkspaceContext()
    if (ctx.authUser.is_anonymous) throw new Error('Create your account first.')

    const { foreman } = await readAnswers(ctx)
    if (!foreman?.installedFirst || foreman.profileAt) return

    await mergeForeman(ctx, { installedFirst: false })
    await stampWorkspaceOnboarded(ctx)
}
