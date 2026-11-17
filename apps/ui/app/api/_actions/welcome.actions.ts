'use server'

import { isTemplateCategory, platformHost, type TemplateCategory } from '@rerun/contracts'

import type { WelcomeProgress } from '@/app/actions/onboarding'
import { requireAdminContext, type WorkspaceContext } from '@/app/api/_auth/ownership'
import { ensureWorkspaceNamed } from '@/app/api/_services/naming.service'
import { requestCompanyExplore } from '@/lib/brain/request-seed'
import { decideIndustry } from '@/lib/company/decide-industry'
import { companySiteUrl } from '@/lib/company/firecrawl'
import { analyzeCompanyProfile } from '@/lib/company/profile'
import type { ForemanAnswers } from '@/lib/foreman/phase'
import { readAnswers, writeAnswers } from '@/lib/foreman/profile'
import { failure, failureOf } from '@/lib/i18n/action-error'
import { takeIntakeCall } from '@/lib/onboarding/anonymous-intake-quota'
import type { ActionResult } from './space.actions'

// The welcome page's answers, each written the moment it is given so a reload resumes on the next
// question. The profile fields are the ones every other reader already knows (the Chief of Staff's
// prompt, the workspace name, the lifecycle emails). `foreman.profileAt` is never written here: it
// would put the workspace in the onboarding chat's funnel, whose phases the engine's Chief of Staff
// waits behind.

// The read started while the site was being typed is usually done by the time it is sent. One that
// is not gets this long before the address is kept alone: the questions do not wait on a slow site.
const SITE_READ_BUDGET_MS = 12_000

async function welcomeContext(): Promise<WorkspaceContext> {
    const ctx = await requireAdminContext()
    if (ctx.authUser.is_anonymous) throw new Error('Create your account first.')
    return ctx
}

async function saveAnswers(ctx: WorkspaceContext, change: (answers: ForemanAnswers) => ForemanAnswers): Promise<ForemanAnswers> {
    const next = change(await readAnswers(ctx))
    await writeAnswers(ctx, next, false)
    return next
}

const withProgress = (answers: ForemanAnswers, progress: WelcomeProgress): ForemanAnswers => ({ ...answers, onboarding: { ...answers.onboarding, ...progress } })

const withinBudget = <T>(work: Promise<T>, fallback: T): Promise<T> => Promise.race([work, new Promise<T>(resolve => setTimeout(() => resolve(fallback), SITE_READ_BUDGET_MS))])

/**
 * The company website, read for what it sells, or `null` for someone who has none. What comes back
 * is the industry the read files it under, which the next question opens already picked.
 */
export async function saveWelcomeSiteAction(site: string | null): Promise<ActionResult<{ industry: TemplateCategory | null }>> {
    try {
        const ctx = await welcomeContext()
        if (site === null) {
            await saveAnswers(ctx, answers => {
                const { company_url: _url, company_name: _name, company_description: _description, company_offering: _offering, company_audience: _audience, ...rest } = answers
                return withProgress(rest, { siteSkipped: true, siteIndustry: undefined })
            })
            return { ok: true, industry: null }
        }

        const platform = platformHost(site)
        if (platform) return failure('notYourCompanySite', { domain: platform })
        const url = companySiteUrl(site)
        if (!url) return failure('notAWebsiteAddress')

        const analysis = await withinBudget(analyzeCompanyProfile(url), null)
        const profile = analysis?.ok ? analysis.analysis.profile : null
        const industry = profile?.industry && isTemplateCategory(profile.industry) ? profile.industry : null

        await saveAnswers(ctx, answers =>
            withProgress(
                {
                    ...answers,
                    company_url: analysis?.ok ? analysis.analysis.url : url,
                    company_name: profile?.name ?? undefined,
                    company_description: profile?.description ?? undefined,
                    company_offering: profile?.offering ?? undefined,
                    company_audience: profile?.audience ?? undefined,
                },
                { siteSkipped: false, siteIndustry: industry ?? undefined }
            )
        )

        // The paid sources and the workspace name both read the address just written.
        await requestCompanyExplore(ctx.supabase, ctx.workspace.id, url).catch(err => console.error('Failed to request a company exploration', ctx.workspace.id, err))
        await ensureWorkspaceNamed({ workspaceId: ctx.workspace.id, userId: ctx.userId })
        return { ok: true, industry }
    } catch (err) {
        return failureOf(err, 'saveAnswerFailed')
    }
}

/**
 * A tile, or what they typed under "Other": kept verbatim beside the bucket it is filed into, the
 * catch-all when nothing fits.
 */
export async function saveWelcomeIndustryAction(choice: { industry: TemplateCategory } | { label: string }): Promise<ActionResult<{ industry: TemplateCategory }>> {
    try {
        const ctx = await welcomeContext()
        const label = 'label' in choice ? choice.label.trim().slice(0, 120) : ''
        if ('label' in choice && !label) return failure('saveAnswerFailed')
        const decided = label && takeIntakeCall(ctx.workspace.id, 'decide') ? ((await decideIndustry(label))?.industry ?? null) : null
        const industry: TemplateCategory = 'industry' in choice && isTemplateCategory(choice.industry) ? choice.industry : (decided ?? 'other')

        await saveAnswers(ctx, answers => withProgress({ ...answers, industry, company_offering: answers.company_offering ?? (label || undefined) }, { industryLabel: label || undefined }))
        return { ok: true, industry }
    } catch (err) {
        return failureOf(err, 'saveAnswerFailed')
    }
}

export async function saveWelcomeRoleAction(position: string): Promise<ActionResult> {
    try {
        const ctx = await welcomeContext()
        const role = position.trim().slice(0, 120)
        if (!role) return failure('saveAnswerFailed')
        await saveAnswers(ctx, answers => ({ ...answers, position: role }))
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'saveAnswerFailed')
    }
}

/** The team step is over, invites sent or skipped: each invitation was sent as it was added. */
export async function finishWelcomeTeamAction(): Promise<ActionResult> {
    try {
        const ctx = await welcomeContext()
        await saveAnswers(ctx, answers => withProgress(answers, { teamDone: true }))
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'saveAnswerFailed')
    }
}
