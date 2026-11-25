'use server'

import type { TemplateCategory } from '@rerun/contracts'

import type { WelcomeProgress } from '@/app/actions/onboarding'
import { requireAdminContext, type WorkspaceContext } from '@/app/api/_auth/ownership'
import { ensureWorkspaceNamed } from '@/app/api/_services/naming.service'
import { requestCompanyExplore } from '@/lib/brain/request-seed'
import { decideIndustry } from '@/lib/company/decide-industry'
import { readCompanySite } from '@/lib/company/company-site'
import type { ForemanAnswers } from '@/lib/foreman/phase'
import { readAnswers, saveFirstName, writeAnswers } from '@/lib/foreman/profile'
import { failure, failureOf } from '@/lib/i18n/action-error'
import { takeIntakeCall } from '@/lib/onboarding/anonymous-intake-quota'
import type { ForemanIntake } from '@/lib/onboarding/intake'
import { sectorById } from '@/lib/onboarding/sectors'
import { parseWorkspaceView, type WorkspaceView } from '@/lib/workspace-view'
import type { ActionResult } from './space.actions'

// The welcome page's answers, each written the moment it is given so a reload resumes on the next
// question. The profile fields are the ones every other reader already knows (the Chief of Staff's
// prompt, the workspace name, the lifecycle emails). `foreman.profileAt` is never written here: it
// would put the workspace in the onboarding chat's funnel, whose phases the engine's Chief of Staff
// waits behind.

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

/**
 * The app's welcome card: the site, the line of work and the role handed over at once, where the page
 * above saves each as it is answered. What comes back is the industry that was stored.
 */
export async function saveWelcomeIntakeAction(intake: ForemanIntake): Promise<{ industry: TemplateCategory }> {
    const ctx = await welcomeContext()
    const site = intake.companyUrl ? await readCompanySite(intake.companyUrl) : null
    const profile = site?.profile ?? null
    const siteIndustry = site?.industry ?? null
    // The one they picked is the only one that is not a guess; `other` when nothing could be told, so
    // the question is not asked again.
    const industry: TemplateCategory = intake.industry ?? siteIndustry ?? intake.decidedIndustry ?? 'other'

    await saveAnswers(ctx, answers =>
        withProgress(
            {
                ...answers,
                company_url: site?.url ?? answers.company_url,
                company_name: profile?.name ?? answers.company_name,
                company_description: profile?.description ?? answers.company_description,
                company_offering: profile?.offering ?? intake.industryLabel ?? answers.company_offering,
                company_audience: profile?.audience ?? answers.company_audience,
                industry,
                position: intake.position ?? answers.position,
            },
            { siteSkipped: !site, siteIndustry: siteIndustry ?? undefined, industryLabel: intake.industryLabel ?? undefined }
        )
    )

    // Before the exploration, which looks for the person on LinkedIn by their first name.
    if (intake.firstName) await saveFirstName(ctx, intake.firstName)
    if (site) await requestCompanyExplore(ctx.supabase, ctx.workspace.id, site.url).catch(err => console.error('Failed to request a company exploration', ctx.workspace.id, err))
    await ensureWorkspaceNamed({ workspaceId: ctx.workspace.id, userId: ctx.userId })
    return { industry }
}

/**
 * The line of work they picked, or what they typed instead: kept verbatim beside the bucket it is
 * filed into, the catch-all when nothing fits.
 */
export async function saveWelcomeSectorAction(choice: { sector: string } | { label: string }): Promise<ActionResult<{ industry: TemplateCategory }>> {
    try {
        const ctx = await welcomeContext()
        const sector = 'sector' in choice ? sectorById(choice.sector) : null
        const label = 'label' in choice ? choice.label.trim().slice(0, 120) : ''
        if (!sector && !label) return failure('saveAnswerFailed')
        const decided = label && takeIntakeCall(ctx.workspace.id, 'decide') ? ((await decideIndustry(label))?.industry ?? null) : null
        const industry: TemplateCategory = sector?.category ?? decided ?? 'other'

        await saveAnswers(ctx, answers => {
            // What they sell is only ever their own words until the site says better: a new answer
            // replaces the words of the one before.
            const said = answers.company_offering === answers.onboarding?.industryLabel ? undefined : answers.company_offering
            return withProgress({ ...answers, industry, company_offering: said ?? (label || undefined) }, { sector: sector?.id, industryLabel: label || undefined })
        })
        return { ok: true, industry }
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

export async function saveWelcomeViewAction(view: WorkspaceView): Promise<ActionResult> {
    try {
        const chosen = parseWorkspaceView(view)
        if (!chosen) return failure('saveAnswerFailed')
        const ctx = await welcomeContext()
        await saveAnswers(ctx, answers => withProgress(answers, { view: chosen }))
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'saveAnswerFailed')
    }
}
