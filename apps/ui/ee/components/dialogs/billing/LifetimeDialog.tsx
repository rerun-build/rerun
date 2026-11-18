'use client'

import { Stripes } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import type { LifetimeBillingState } from '@/ee/services/lifetime-addons.service'
import { useEnabledPaidApps } from '@/components/layout/FeatureFlagsProvider'
import { PanelSteps } from '@/components/ui/panel-steps'
import { arePaidAppsOffered } from '@/ee/lib/billing/plans'
import { APP_SLUGS, type AppSlug } from '@/lib/apps/types'
import { ChevronRightIcon, KeyIcon } from '@/lib/icons'
import type { BillingHighlight } from '@/stores/billing.store'
import { usePaidAppsStore } from '@/stores/paid-apps.store'
import { useSession } from '@/supabase/session/SessionProvider'

import { AppsSection, appSlotsOf, useAppSlots, type AppSlots, type AppSlotsState } from './AppsSection'
import { BillingDialogShell } from './BillingDialogShell'
import { BusinessDetailsPane, BusinessDetailsRow } from './BusinessDetailsPane'
import { shortDate } from './checkout-copy'
import { CreditCard } from './credit-usage/CreditCard'
import { UsagePane } from './credit-usage/UsagePane'
import { useCreditUsage } from './credit-usage/useCreditUsage'
import { CreditPane } from './CreditPane'
import { InvoicesPane } from './InvoicesPane'
import { LifetimeSlotsPane } from './LifetimeSlotsPane'
import { CreditUsageRow, InvoicesRow, OverviewLinkRow } from './OverviewRows'
import { Headline, LifetimeDealCard, RightTitle, SuccessPanel, SummaryRows, usd } from './parts'

type Drill = 'overview' | 'invoices' | 'credit' | 'usage' | 'business'
type Success = { title: string; body: string }

// The plan dialog of a workspace that paid once: the same frame as Pro, the lifetime deal in place of
// the plan, then the Rerun credit and the apps, which are billed apart from it.
// `appSlots` stands in for the fetched accounts, for the lab only.
export function LifetimeDialog({
    state,
    highlightAddon,
    onClose,
    onChanged,
    onConnectAi,
    appSlots,
}: {
    state: LifetimeBillingState
    highlightAddon: BillingHighlight | null
    onClose: () => void
    onChanged: () => Promise<void>
    onConnectAi: () => void
    appSlots?: Partial<Record<AppSlug, AppSlotsState>>
}) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const { workspace, refreshWorkspace } = useSession()
    const currentSlots = appSlotsOf(state.quantities)
    const enabledApps = useEnabledPaidApps()
    const shownApps = arePaidAppsOffered(workspace) ? APP_SLUGS.filter(slug => enabledApps.includes(slug) || currentSlots[slug] > 0) : []
    const fetchedSlots = useAppSlots(shownApps, !!appSlots)
    const slotsStates = appSlots ?? fetchedSlots
    const openApp = usePaidAppsStore(s => s.openApp)
    const [slots, setSlots] = useState<AppSlots>(currentSlots)
    const [drill, setDrill] = useState<Drill>(highlightAddon === 'credit_pack' ? 'credit' : 'overview')
    const [success, setSuccess] = useState<Success | null>(null)
    // A lifetime deal comes with no monthly credit: what it holds is bought, and never resets.
    const credit = { ...useCreditUsage(), resetsOn: null }
    const renewal = state.periodEnd ? shortDate(state.periodEnd, locale) : t('plan.yourRenewal')
    const dirty = APP_SLUGS.some(slug => slots[slug] !== currentSlots[slug])
    const added = APP_SLUGS.reduce((count, slug) => count + Math.max(0, slots[slug] - currentSlots[slug]), 0)

    // Its last slot given back, the subscription still carries it until it ends: nothing is left to
    // change on it from here.
    const lockedReason = state.cancelAtPeriodEnd ? t('plan.status.ends', { date: renewal }) : undefined

    // Stripe's Checkout sells the first slot alone, and a running trial holds one slot per app.
    const moreReason = (slug: AppSlug) =>
        state.slotsCheckout && added > 0 ? t('lifetime.slots.oneOnCheckout') : state.trialing && slots[slug] > 0 ? t('lifetime.slots.oneDuringTrial') : undefined

    const done = async (next: Success) => {
        await refreshWorkspace()
        await onChanged()
        setSuccess(next)
    }

    const left = (
        <>
            <Headline badge={{ label: t('lifetime.badge'), tone: 'green' }} title={t('lifetime.title')} subtitle={t('lifetime.subtitle')} />
            <div className="mt-6">
                <LifetimeDealCard />
            </div>
            <div className="mt-3">
                <CreditCard credit={credit} highlight={drill === 'credit'} onAdd={() => setDrill('credit')} onOpenUsage={() => setDrill('usage')} />
            </div>
            {shownApps.length > 0 && (
                <div className="mt-6">
                    <AppsSection
                        description={t('lifetime.appsDescription')}
                        rows={shownApps.map(slug => ({
                            slug,
                            value: slots[slug],
                            current: currentSlots[slug],
                            slotsState: slotsStates[slug] ?? { overview: null, loaded: false },
                            moreReason: moreReason(slug),
                            lockedReason,
                            onOpen: enabledApps.includes(slug)
                                ? () => {
                                      onClose()
                                      openApp(slug)
                                  }
                                : undefined,
                        }))}
                        interval="monthly"
                        renewal={renewal}
                        disabled={!!success}
                        onChange={(slug, value) => setSlots(current => ({ ...current, [slug]: value }))}
                    />
                </div>
            )}
        </>
    )

    const right = success ? (
        <SuccessPanel title={success.title} body={success.body} cta={t('plan.success.done')} onDone={onClose} />
    ) : dirty ? (
        <LifetimeSlotsPane state={state} slots={slots} onReset={() => setSlots(currentSlots)} onApplied={done} onFailed={onChanged} />
    ) : (
        <PanelSteps stepKey={drill} depth={drill === 'overview' ? 0 : 1}>
            {drill === 'invoices' ? (
                <InvoicesPane onBack={() => setDrill('overview')} />
            ) : drill === 'credit' ? (
                <CreditPane onBack={() => setDrill('overview')} onDone={next => void done(next)} />
            ) : drill === 'usage' ? (
                <UsagePane credit={credit} onBack={() => setDrill('overview')} />
            ) : drill === 'business' ? (
                <BusinessDetailsPane business={state.business} onBack={() => setDrill('overview')} onSaved={onChanged} />
            ) : (
                <LifetimeOverviewPane
                    state={state}
                    creditLeftMicros={credit.balance?.leftMicros ?? null}
                    onInvoices={() => setDrill('invoices')}
                    onUsage={() => setDrill('usage')}
                    onBusiness={() => setDrill('business')}
                    onConnectAi={onConnectAi}
                />
            )}
        </PanelSteps>
    )

    return <BillingDialogShell title={t('lifetime.title')} left={left} right={right} />
}

function LifetimeOverviewPane({
    state,
    creditLeftMicros,
    onInvoices,
    onUsage,
    onBusiness,
    onConnectAi,
}: {
    state: LifetimeBillingState
    creditLeftMicros: number | null
    onInvoices: () => void
    onUsage: () => void
    onBusiness: () => void
    onConnectAi: () => void
}) {
    const locale = useLocale()
    const t = useTranslations('billing')

    const appsRow = state.nextInvoice
        ? [{ label: t('plan.nextInvoice'), value: `${shortDate(state.nextInvoice.at, locale)} · ${usd(state.nextInvoice.amountCents)}` }]
        : state.cancelAtPeriodEnd && state.periodEnd
          ? [{ label: t('lifetime.overview.apps'), value: t('plan.status.ends', { date: shortDate(state.periodEnd, locale) }), muted: true }]
          : []

    return (
        <>
            <Stripes fade="bottom" className="opacity-50" />
            <div className="relative flex flex-1 flex-col">
                <RightTitle>{t('plan.overview.title')}</RightTitle>
                <div className="mt-6 flex flex-col gap-3">
                    <SummaryRows rows={[{ label: t('lifetime.overview.deal'), value: t('lifetime.overview.paidOnce') }, ...appsRow]} />
                    {state.hasCustomer && <InvoicesRow onOpen={onInvoices} />}
                    {state.hasCustomer && <BusinessDetailsRow business={state.business} onOpen={onBusiness} />}
                    <CreditUsageRow leftMicros={creditLeftMicros} onOpen={onUsage} />
                    <OverviewLinkRow icon={KeyIcon} label={t('lifetime.overview.aiProviders')} value={<ChevronRightIcon className="size-4" />} onOpen={onConnectAi} />
                </div>
            </div>
        </>
    )
}
