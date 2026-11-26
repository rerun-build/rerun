'use client'

import { ScrollFade } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'

import { BrandLogo } from '@/components/brand/BrandLogo'
import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { useEnabledPaidApps } from '@/components/layout/FeatureFlagsProvider'
import { PanelSteps } from '@/components/ui/panel-steps'
import { Skeleton } from '@/components/ui/skeleton'
import type { SubscriptionState } from '@/ee/services/billing.service'
import { APP_SLUGS } from '@/lib/apps/types'
import { BarChart3, Building2, CoinsIcon, CreditCardIcon, FileTextIcon, Grid2x2Icon, TriangleAlertIcon, UserPlus } from '@/lib/icons'
import { useSession } from '@/supabase/session/SessionProvider'

import type { CancelFlowHeader } from '../../cancel-subscription/CancelFlow'
import { appSlotsOf, useAppSlots } from '../AppsSection'
import { useCreditUsage } from '../credit-usage/useCreditUsage'
import { useInvoices } from '../InvoicesPane'
import { SuccessPanel } from '../parts'
import { useReferrals } from '../referrals/useReferrals'
import { daysLeft } from './account'
import { AppsPanel } from './AppsPanel'
import { CancelFlowPanel, CancelPanel } from './CancelPanels'
import { CreditsPanel, UsagePanel } from './CreditsPanels'
import { Home } from './Home'
import { BusinessPanel, CardPanel, InvoicesPanel, PaymentPanel, ReferralPanel } from './PaymentPanels'
import { PlanPanel } from './PlanPanel'
import { billingDate } from './bits'
import type { PanelProps, Success, TilesData, View } from './views'

type Glyph = ComponentType<{ className?: string }>

type Header = { icon: Glyph | ReactNode; title: string; description: string; backLabel?: string }

// A page reached from another page goes back to it rather than to the home.
const PARENT: Partial<Record<View, View>> = { usage: 'credits', card: 'payment', business: 'payment', cancelFlow: 'cancel' }

function depthOf(view: View, cancelDepth: number): number {
    if (view === 'home') return 0
    if (view === 'cancelFlow') return 2 + cancelDepth
    return PARENT[view] ? 2 : 1
}

function usePageHeader(view: Exclude<View, 'home' | 'cancelFlow'>, state: SubscriptionState): Header {
    const t = useTranslations('billing.tiles.pages')
    const trial = state.status === 'trialing'
    const billing = t('billing')
    switch (view) {
        case 'plan':
            return { icon: <BrandLogo size="md" />, title: trial ? t('plan.trialTitle') : t('plan.title'), description: trial ? t('plan.trialDescription') : t('plan.description'), backLabel: billing }
        case 'credits':
            return { icon: CoinsIcon, title: t('credits.title'), description: trial ? t('credits.trialDescription') : t('credits.description'), backLabel: billing }
        case 'usage':
            return { icon: BarChart3, title: t('usage.title'), description: t('usage.description'), backLabel: t('credits.title') }
        case 'apps':
            return { icon: Grid2x2Icon, title: t('apps.title'), description: t('apps.description'), backLabel: billing }
        case 'payment':
            return { icon: CreditCardIcon, title: t('payment.title'), description: t('payment.description'), backLabel: billing }
        case 'card':
            return { icon: CreditCardIcon, title: state.status === 'past_due' ? t('card.payTitle') : state.card ? t('card.replaceTitle') : t('card.addTitle'), description: t('card.description'), backLabel: t('payment.title') }
        case 'business':
            return { icon: Building2, title: t('business.title'), description: t('business.description'), backLabel: t('payment.title') }
        case 'invoices':
            return { icon: FileTextIcon, title: t('invoices.title'), description: t('invoices.description'), backLabel: billing }
        case 'referral':
            return { icon: UserPlus, title: t('referral.title'), description: t('referral.description'), backLabel: billing }
        case 'cancel':
            return { icon: TriangleAlertIcon, title: trial ? t('cancel.trialTitle') : t('cancel.title'), description: t('cancel.description'), backLabel: billing }
    }
}

function useHomeHeader(state: SubscriptionState, trialDaysLeft: number | null): Header {
    const t = useTranslations('billing.tiles.pages.home')
    const locale = useLocale()
    const date = state.periodEnd ? billingDate(state.periodEnd, locale) : ''
    const description =
        state.status === 'past_due'
            ? t('declined')
            : state.cancelAtPeriodEnd
              ? t('ends', { date })
              : state.status === 'trialing'
                ? t('trial', { count: trialDaysLeft ?? 0 })
                : t('renews', { date })
    return { icon: CreditCardIcon, title: t('title'), description }
}

// The billing of a workspace with a plan to manage: a home of tiles, and a page for each thing it
// changes, sliding in under the one header, which goes back. The Machine tile is a placeholder:
// machine sizes are not sold yet.
export function BillingTilesDialog({ state, initialView = 'home', onChanged }: { state: SubscriptionState; initialView?: View; onChanged: () => Promise<void> }) {
    const t = useTranslations('billing')
    const { workspace, refreshWorkspace } = useSession()
    const [view, setView] = useState<View>(initialView)
    const [success, setSuccess] = useState<Success | null>(null)
    const [cancelHeader, setCancelHeader] = useState<CancelFlowHeader | null>(null)
    const [reloads, setReloads] = useState(0)
    const scrollRef = useRef<HTMLDivElement>(null)
    const [openedAt] = useState(() => Date.now())
    const trialEndsAt = state.status === 'trialing' ? (workspace?.trial_ends_at ?? null) : null

    const enabledApps = useEnabledPaidApps()
    const currentSlots = appSlotsOf(state.quantities)
    const apps = APP_SLUGS.filter(slug => enabledApps.includes(slug) || currentSlots[slug] > 0)
    const invoices = useInvoices(reloads)
    const data: TilesData = {
        credit: useCreditUsage(),
        // The $0 invoice Stripe issues when a trial starts charges for nothing.
        invoices: invoices?.filter(invoice => invoice.amountCents > 0 || invoice.items.length > 0) ?? null,
        referrals: useReferrals(),
        apps,
        appSlots: useAppSlots(apps),
        trialEndsAt,
        trialDaysLeft: trialEndsAt ? daysLeft(trialEndsAt, openedAt) : null,
    }

    const go = (next: View) => {
        if (next === 'cancelFlow') setCancelHeader(null)
        setView(next)
    }
    const back = () => go(PARENT[view] ?? 'home')
    const done = async (next: Success) => {
        await refreshWorkspace()
        await onChanged()
        setReloads(count => count + 1)
        setSuccess(next)
    }
    const refresh = () => {
        void refreshWorkspace()
        void onChanged()
        setReloads(count => count + 1)
    }

    const homeHeader = useHomeHeader(state, data.trialDaysLeft)
    const pageHeader = usePageHeader(view === 'home' ? 'plan' : view === 'cancelFlow' ? 'cancel' : view, state)
    const stepKey = success ? 'success' : view
    const depth = success ? depthOf(view, 0) + 1 : depthOf(view, cancelHeader?.depth ?? 0)
    // The cancellation's steps bring their own header; until the first one is read, the page's.
    const header: Header & { key: string; onBack?: () => void } =
        success || view === 'home'
            ? { ...homeHeader, key: stepKey }
            : view === 'cancelFlow'
              ? cancelHeader
                  ? { ...cancelHeader, key: `cancel:${cancelHeader.key}`, backLabel: pageHeader.title }
                  : { ...pageHeader, icon: <Skeleton className="size-10 rounded-lg" />, key: 'cancel:loading', onBack: () => go('cancel') }
              : { ...pageHeader, key: stepKey, onBack: back }

    useLayoutEffect(() => {
        scrollRef.current?.scrollTo({ top: 0 })
    }, [stepKey, cancelHeader?.key])

    const props: PanelProps = { state, data, go, onBack: back, onDone: done }
    const body = success ? (
        <SuccessPanel
            title={success.title}
            body={success.body}
            rows={success.rows}
            cta={t('plan.success.done')}
            onDone={() => {
                setSuccess(null)
                setView('home')
            }}
        />
    ) : view === 'plan' ? (
        <PlanPanel {...props} />
    ) : view === 'credits' ? (
        <CreditsPanel {...props} />
    ) : view === 'usage' ? (
        <UsagePanel {...props} />
    ) : view === 'apps' ? (
        <AppsPanel {...props} />
    ) : view === 'payment' ? (
        <PaymentPanel {...props} />
    ) : view === 'card' ? (
        <CardPanel {...props} />
    ) : view === 'business' ? (
        <BusinessPanel {...props} />
    ) : view === 'invoices' ? (
        <InvoicesPanel {...props} />
    ) : view === 'referral' ? (
        <ReferralPanel {...props} />
    ) : view === 'cancel' ? (
        <CancelPanel {...props} />
    ) : view === 'cancelFlow' ? (
        <CancelFlowPanel onHeader={setCancelHeader} onLeave={go} onChanged={refresh} />
    ) : (
        <Home state={state} data={data} go={go} onDone={done} />
    )

    return (
        <PanelDialogContent className="sm:h-[min(46rem,90dvh)] sm:max-w-2xl">
            <DialogHeaderBar icon={header.icon} title={header.title} description={header.description} onBack={header.onBack} backLabel={header.backLabel} page={{ key: header.key, depth }} />
            <ScrollFade scrollRef={scrollRef} className="@container min-h-0 flex-1">
                <div className="flex min-h-full flex-col p-4">
                    <PanelSteps stepKey={stepKey} depth={depth}>
                        {body}
                    </PanelSteps>
                </div>
            </ScrollFade>
        </PanelDialogContent>
    )
}

// What the dialog shows while the subscription is read: the home's own frame, empty.
export function BillingTilesSkeleton() {
    const t = useTranslations('billing.tiles.pages.home')
    return (
        <PanelDialogContent className="sm:h-[min(46rem,90dvh)] sm:max-w-2xl">
            <DialogHeaderBar icon={CreditCardIcon} title={t('title')} description={'\u00a0'} />
            <div className="@container flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
                <Skeleton className="h-20 w-full rounded-xl" />
                <div className="grid gap-3 @lg:grid-cols-2">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Skeleton key={index} className="h-44 w-full rounded-xl" />
                    ))}
                </div>
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-28 w-full rounded-xl" />
            </div>
        </PanelDialogContent>
    )
}
