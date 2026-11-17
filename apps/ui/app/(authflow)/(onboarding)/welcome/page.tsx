import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { requireWorkspaceContext, type WorkspaceContext } from '@/app/api/_auth/ownership'
import { resolveEngineWaitlist } from '@/app/api/_services/waitlist.service'
import { internalPath } from '@/lib/auth/internal-path'
import { siteDomain } from '@/lib/onboarding/site-favicon'
import { readWelcomeState } from '@/lib/onboarding/welcome.server'
import { routes } from '@/lib/routes'
import { getServerSession } from '@/supabase/session/getServerSession'
import { SessionProvider } from '@/supabase/session/SessionProvider'
import { selectMany } from '@/supabase/supabase-helpers'
import { BILLING_ENABLED, isSubscriptionEntitled } from '@rerun/cloud/billing'
import { BillingDialog } from '@rerun/cloud/billing.client'
import { isPhoneStepPending } from '@rerun/cloud/phone.server'
import { isTemplateCategory } from '@rerun/contracts'
import { WelcomeFlow } from './WelcomeFlow'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('onboarding')
    return { title: t('metaTitle'), robots: { index: false, follow: false } }
}

// The onboarding of a new workspace, in the dialog the sign-in opened over the app. Only its admin, and only
// once: anyone else, or a workspace past it, is sent on to where they were going.
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
    const next = internalPath((await searchParams).next, routes.home)

    let ctx: WorkspaceContext
    try {
        ctx = await requireWorkspaceContext()
    } catch {
        // Signed in without a workspace to act in: the sign-in would send them straight back here.
        const signedIn = await getServerSession().then(
            ({ session }) => !!session,
            () => false
        )
        redirect(signedIn ? routes.home : `${routes.auth}?next=${encodeURIComponent(`/welcome${next === routes.home ? '' : `?next=${encodeURIComponent(next)}`}`)}`)
    }

    const state = await readWelcomeState(ctx)
    if (!state.needed) redirect(next)

    const [{ data: pending }, phonePending, waitlisted] = await Promise.all([
        selectMany(ctx.supabase, 'workspace_invitations', ['email'] as const, { workspace_id: ctx.workspace.id, status: 'pending' }),
        isPhoneStepPending(ctx.supabase, ctx.userId),
        resolveEngineWaitlist(ctx.workspace.id),
    ])
    const { answers } = state
    const siteIndustry = answers.onboarding?.siteIndustry
    const industry = answers.industry && isTemplateCategory(answers.industry) ? answers.industry : null

    return (
        <SessionProvider>
            <WelcomeFlow
                initialStep={state.step}
                afterQuestions={BILLING_ENABLED && !isSubscriptionEntitled(ctx.workspace.subscription_status) ? 'trial' : 'engine'}
                initial={{
                    site: answers.company_url ? (siteDomain(answers.company_url) ?? answers.company_url) : '',
                    siteIndustry: siteIndustry && isTemplateCategory(siteIndustry) ? siteIndustry : null,
                    industry,
                    industryLabel: answers.onboarding?.industryLabel ?? '',
                    role: answers.position ?? '',
                    invites: (pending ?? []).map(invite => ({ email: invite.email })),
                }}
                firstName={state.firstName}
                next={next}
                phonePending={phonePending}
                waitlisted={waitlisted}
            />
            <BillingDialog />
        </SessionProvider>
    )
}
