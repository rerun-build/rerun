import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { requireWorkspaceContext, type WorkspaceContext } from '@/app/api/_auth/ownership'
import { resolveEngineWaitlist } from '@/app/api/_services/waitlist.service'
import { internalPath } from '@/lib/auth/internal-path'
import { requestHostScope } from '@/lib/brand/host-scope'
import { opensOnHost } from '@/lib/workspace/host-workspace'
import { sectorById } from '@/lib/onboarding/sectors'
import { readStarterRoles } from '@/lib/onboarding/starter-roles.server'
import { readWelcomeState } from '@/lib/onboarding/welcome.server'
import { routes } from '@/lib/routes'
import { getServerSession } from '@/supabase/session/getServerSession'
import { SessionProvider } from '@/supabase/session/SessionProvider'
import { WorkspaceSwitchLoader } from '@/components/layout/WorkspaceSwitchLoader'
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

// Read on the server so the workspace pill holds its row from the first paint, the session's list
// of workspaces only arriving after it. Sandboxes are left out, as in the pill's menu.
async function hasAnotherWorkspace(ctx: WorkspaceContext): Promise<boolean> {
    const scope = await requestHostScope()
    const { data: memberships } = await selectMany(ctx.supabase, 'workspace_members', ['workspace_id'] as const, { user_id: ctx.userId })
    const ids = (memberships ?? []).map(m => m.workspace_id)
    if (ids.length < 2) return false
    const { data: workspaces } = await selectMany(ctx.supabase, 'workspaces', ['organization_id'] as const, { id: ids, is_sandbox: false })
    return (workspaces ?? []).filter(workspace => opensOnHost(scope, workspace.organization_id)).length > 1
}

// The onboarding of a new workspace, on the page the sign-in opened. Only its admin, and only
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

    const [{ data: pending }, phonePending, waitlisted, canSwitchWorkspace, starterRoles] = await Promise.all([
        selectMany(ctx.supabase, 'workspace_invitations', ['email'] as const, { workspace_id: ctx.workspace.id, status: 'pending' }),
        isPhoneStepPending(ctx.supabase, ctx.userId),
        resolveEngineWaitlist(ctx.workspace.id),
        hasAnotherWorkspace(ctx),
        readStarterRoles(ctx.supabase),
    ])
    const { answers } = state
    const industry = answers.industry && isTemplateCategory(answers.industry) ? answers.industry : null

    return (
        <SessionProvider hostScope={await requestHostScope()}>
            <WelcomeFlow
                initialStep={state.step}
                afterQuestions={BILLING_ENABLED && !isSubscriptionEntitled(ctx.workspace.subscription_status) ? 'trial' : 'engine'}
                initial={{
                    sector: sectorById(answers.onboarding?.sector)?.id ?? null,
                    sectorLabel: answers.onboarding?.industryLabel ?? '',
                    industry,
                    invites: (pending ?? []).map(invite => ({ email: invite.email })),
                }}
                starterRoles={starterRoles}
                firstName={state.firstName}
                next={next}
                phonePending={phonePending}
                waitlisted={waitlisted}
                canSwitchWorkspace={canSwitchWorkspace}
            />
            <BillingDialog />
            <WorkspaceSwitchLoader />
        </SessionProvider>
    )
}
