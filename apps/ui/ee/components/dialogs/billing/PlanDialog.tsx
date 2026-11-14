'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useCheckout } from '@stripe/react-stripe-js/checkout'
import type { StripeExpressCheckoutElementConfirmEvent } from '@stripe/stripe-js'
import { useLocale, useTranslations } from 'next-intl'
import { Badge, Stripes, type BadgeTone } from '@rerun/ui/primitives'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import {
    cancelPendingSwitchAction,
    confirmCardSetupAction,
    createPlanCardSetupAction,
    listInvoicesAction,
    resumeSubscriptionAction,
} from '@/ee/actions/billing.actions'
import { runPlanChange } from '@/ee/lib/billing/plan-payment'
import type { InvoiceSummary, PlanSelection, SubscriptionState } from '@/ee/services/billing.service'
import { Button } from '@/components/ui/button'
import { PanelSteps } from '@/components/ui/panel-steps'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { formatCredits, planDiscountCents, planPriceCents, type AddonQuantities, type BillingInterval } from '@/ee/lib/billing/plans'
import { ChevronRightIcon, CoinsIcon, ExternalLinkIcon, Receipt } from '@/lib/icons'
import { useSession } from '@/supabase/session/SessionProvider'
import type { BillingHighlight } from '@/stores/billing.store'

import { BillingDialogShell } from './BillingDialogShell'
import { BusinessDetailsPane, BusinessDetailsRow } from './BusinessDetailsPane'
import { AppsSection, appSlotsLabel, appSlotsOf, useAppSlots, withAppSlots, type AppSlots, type AppSlotsState } from './AppsSection'
import { useEnabledPaidApps } from '@/components/layout/FeatureFlagsProvider'
import { appInfo } from '@/lib/apps/catalog'
import { APP_SLUGS, type AppSlug } from '@/lib/apps/types'
import { usePaidAppsStore } from '@/stores/paid-apps.store'
import { CreditCard } from './credit-usage/CreditCard'
import { CreditPane } from './CreditPane'
import { UsagePane } from './credit-usage/UsagePane'
import { useCreditUsage } from './credit-usage/useCreditUsage'
import { longDate, shortDate } from './checkout-copy'
import { BilledFlow, CardOnFile, CountFlow, IntervalToggle, Notice, PayFooter, PlanCard, RightTitle, SuccessPanel, SummaryRows, TermsConsent, usd } from './parts'
import { StripeCheckoutProvider, StripePaymentFields, StripePaymentFieldsSkeleton } from './StripeCheckout'
import { usePlanQuote } from './usePlanQuote'

type Drill = 'overview' | 'card' | 'invoices' | 'credit' | 'usage' | 'business'
type Success = { title: string; body: string; rows?: { label: string; value: string }[] }

type BillingTranslator = ReturnType<typeof useTranslations<'billing'>>

function billed(cents: number, interval: BillingInterval, t: BillingTranslator): string {
    return t(interval === 'yearly' ? 'plan.billed.yearly' : 'plan.billed.monthly', { price: usd(cents) })
}

// What the plan bills each interval at `quantities`, with the legacy price and the promos it keeps.
function planBillCents(state: SubscriptionState, quantities: AddonQuantities, interval: BillingInterval): number {
    return Math.max(0, planPriceCents(quantities, interval, state.priceArm) - planDiscountCents(state, interval))
}

function statusOf(state: SubscriptionState, locale: string, t: BillingTranslator): { label: string; tone: BadgeTone } {
    if (state.status === 'past_due') return { label: t('plan.status.paymentFailed'), tone: 'red' }
    if (state.cancelAtPeriodEnd) return { label: state.periodEnd ? t('plan.status.ends', { date: shortDate(state.periodEnd, locale) }) : t('plan.status.ending'), tone: 'orange' }
    if (state.pendingSwitch) return { label: t('plan.status.monthlyFrom', { date: shortDate(state.pendingSwitch.at, locale) }), tone: 'yellow' }
    return { label: t('plan.status.active'), tone: 'green' }
}

// `appSlots` stands in for the fetched accounts, for the lab only.
export function PlanDialog({
    state,
    highlightAddon,
    onClose,
    onCancel,
    onChanged,
    appSlots,
}: {
    state: SubscriptionState
    highlightAddon: BillingHighlight | null
    onClose: () => void
    onCancel: () => void
    onChanged: () => Promise<void>
    appSlots?: Partial<Record<AppSlug, AppSlotsState>>
}) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const { refreshWorkspace } = useSession()
    const currentSlots = appSlotsOf(state.quantities)
    const [slots, setSlots] = useState<AppSlots>(currentSlots)
    const enabledApps = useEnabledPaidApps()
    const shownApps = APP_SLUGS.filter(slug => enabledApps.includes(slug) || currentSlots[slug] > 0)
    const fetchedSlots = useAppSlots(shownApps, !!appSlots)
    const slotsStates = appSlots ?? fetchedSlots
    const openApp = usePaidAppsStore(s => s.openApp)
    const [interval, setBillingInterval] = useState<BillingInterval>(state.interval)
    const [drill, setDrill] = useState<Drill>(highlightAddon === 'credit_pack' ? 'credit' : 'overview')
    const [success, setSuccess] = useState<Success | null>(null)
    const credit = useCreditUsage()

    const pastDue = state.status === 'past_due'
    const locked = pastDue || state.cancelAtPeriodEnd || !!success
    const dirty = APP_SLUGS.some(slug => slots[slug] !== currentSlots[slug]) || interval !== state.interval
    const renewal = state.periodEnd ? shortDate(state.periodEnd, locale) : t('plan.yourRenewal')
    const selection: PlanSelection = { quantities: withAppSlots(state.quantities, slots), interval }
    const currentBillCents = planBillCents(state, state.quantities, state.interval)

    const done = async (next: Success) => {
        await refreshWorkspace()
        await onChanged()
        setSuccess(next)
    }

    const reset = () => {
        setSlots(currentSlots)
        setBillingInterval(state.interval)
    }

    const status = statusOf(state, locale, t)
    const left = (
        <>
            <div className="flex flex-col items-start gap-3">
                <Badge size="sm" tone={status.tone}>
                    {status.label}
                </Badge>
                <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Rerun Pro</h2>
                <p className="text-base text-muted-foreground">
                    {t(
                        state.interval === 'yearly'
                            ? state.cancelAtPeriodEnd
                                ? 'plan.summary.yearlyEnds'
                                : 'plan.summary.yearlyRenews'
                            : state.cancelAtPeriodEnd
                              ? 'plan.summary.monthlyEnds'
                              : 'plan.summary.monthlyRenews',
                        { renewal },
                    )}
                </p>
            </div>
            <div className="mt-6 flex flex-col gap-3">
                <IntervalToggle value={interval} onChange={setBillingInterval} disabled={locked} />
                <PlanCard interval={interval} priceArm={state.priceArm} discountCents={planDiscountCents(state, interval)} />
            </div>
            <div className="mt-3">
                <CreditCard credit={credit} highlight={drill === 'credit'} onAdd={state.cancelAtPeriodEnd || pastDue ? undefined : () => setDrill('credit')} onOpenUsage={state.cancelAtPeriodEnd || pastDue ? undefined : () => setDrill('usage')} />
            </div>
            {shownApps.length > 0 && (
                <div className="mt-6">
                    <AppsSection
                        rows={shownApps.map(slug => ({
                            slug,
                            value: slots[slug],
                            current: currentSlots[slug],
                            slotsState: slotsStates[slug] ?? { overview: null, loaded: false },
                            onOpen: enabledApps.includes(slug)
                                ? () => {
                                      onClose()
                                      openApp(slug)
                                  }
                                : undefined,
                        }))}
                        interval={interval}
                        renewal={renewal}
                        disabled={locked}
                        onChange={(slug, value) => setSlots(current => ({ ...current, [slug]: value }))}
                    />
                </div>
            )}
        </>
    )

    const right = (() => {
        if (success) return <SuccessPanel title={success.title} body={success.body} rows={success.rows} cta={t('plan.success.done')} onDone={onClose} />
        if (pastDue) return <PastDuePane state={state} onDone={() => void done({ title: t('plan.success.paymentReceivedTitle'), body: t('plan.success.paymentReceivedBody') })} />
        if (state.cancelAtPeriodEnd) return <CancelPendingPane state={state} currentBillCents={currentBillCents} onResumed={() => void done({ title: t('plan.success.backOnTitle'), body: t('plan.success.backOnBody', { date: renewal }) })} />
        if (dirty) return <ChangePane state={state} currentBillCents={currentBillCents} selection={selection} onReset={reset} onDone={next => void done(next)} />

        return (
            <PanelSteps stepKey={drill} depth={drill === 'overview' ? 0 : 1}>
                {drill === 'card' ? (
                    <CardPane
                        onBack={() => setDrill('overview')}
                        onSaved={async () => {
                            await onChanged()
                            toast.success(t('plan.cardUpdated'))
                            setDrill('overview')
                        }}
                    />
                ) : drill === 'invoices' ? (
                    <InvoicesPane onBack={() => setDrill('overview')} />
                ) : drill === 'credit' ? (
                    <CreditPane onBack={() => setDrill('overview')} onDone={next => void done(next)} />
                ) : drill === 'usage' ? (
                    <UsagePane credit={credit} onBack={() => setDrill('overview')} />
                ) : drill === 'business' ? (
                    <BusinessDetailsPane business={state.business} onBack={() => setDrill('overview')} onSaved={onChanged} />
                ) : (
                    <OverviewPane
                        state={state}
                        creditLeftMicros={credit.balance?.leftMicros ?? null}
                        onCard={() => setDrill('card')}
                        onInvoices={() => setDrill('invoices')}
                        onUsage={() => setDrill('usage')}
                        onBusiness={() => setDrill('business')}
                        onCancel={onCancel}
                        onChanged={onChanged}
                    />
                )}
            </PanelSteps>
        )
    })()

    return <BillingDialogShell title="Rerun Pro" left={left} right={right} />
}

function OverviewPane({
    state,
    creditLeftMicros,
    onCard,
    onInvoices,
    onUsage,
    onBusiness,
    onCancel,
    onChanged,
}: {
    state: SubscriptionState
    creditLeftMicros: number | null
    onCard: () => void
    onInvoices: () => void
    onUsage: () => void
    onBusiness: () => void
    onCancel: () => void
    onChanged: () => Promise<void>
}) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const errorText = useErrorText()
    const [keeping, setKeeping] = useState(false)

    const keepYearly = async () => {
        setKeeping(true)
        const result = await cancelPendingSwitchAction()
        setKeeping(false)
        if (!result.ok) return toast.error(t('plan.overview.keepYearlyFailed'), { description: errorText(result) })
        await onChanged()
    }

    const rows = [
        { label: t('plan.nextInvoice'), value: state.nextInvoice ? `${shortDate(state.nextInvoice.at, locale)} · ${usd(state.nextInvoice.amountCents)}` : '-' },
        { label: t('plan.overview.billed'), value: state.interval === 'yearly' ? t('plan.overview.billedYearly') : t('plan.overview.billedMonthly'), muted: true },
        ...(state.pendingSwitch
            ? [
                  {
                      label: t('plan.overview.from', { date: shortDate(state.pendingSwitch.at, locale) }),
                      value: t('plan.overview.monthlyPrice', { price: billed(planPriceCents(state.pendingSwitch.selection.quantities, 'monthly', state.priceArm), 'monthly', t) }),
                  },
              ]
            : []),
    ]

    return (
        <>
            <Stripes fade="bottom" className="opacity-50" />
            <div className="relative flex flex-1 flex-col">
                <RightTitle>{t('plan.overview.title')}</RightTitle>
                <div className="mt-6 flex flex-col gap-3">
                    <SummaryRows rows={rows} />
                    <CardOnFile card={state.card} action={t('plan.overview.update')} onAction={onCard} />
                    <button type="button" onClick={onInvoices} className="flex items-center justify-between rounded-xl bg-background/60 px-4 py-3 text-sm ring-1 ring-border hover:bg-background">
                        <span className="flex items-center gap-3">
                            <Receipt className="size-4 text-muted-foreground" />
                            {t('plan.overview.invoices')}
                        </span>
                        <span className="text-muted-foreground underline underline-offset-4">{t('plan.overview.viewAll')}</span>
                    </button>
                    <BusinessDetailsRow business={state.business} onOpen={onBusiness} />
                    <button type="button" onClick={onUsage} className="flex items-center justify-between rounded-xl bg-background/60 px-4 py-3 text-sm ring-1 ring-border hover:bg-background">
                        <span className="flex items-center gap-3">
                            <CoinsIcon className="size-4 text-muted-foreground" />
                            {t('plan.overview.creditUsage')}
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                            {creditLeftMicros != null && <span className="tabular-nums">{t('plan.overview.creditsLeft', { credits: formatCredits(creditLeftMicros, locale) })}</span>}
                            <ChevronRightIcon className="size-4" />
                        </span>
                    </button>
                    {state.pendingSwitch && (
                        <Button variant="outline" onClick={() => void keepYearly()} disabled={keeping}>
                            {t('plan.overview.keepYearly')}
                        </Button>
                    )}
                </div>
                <div className="mt-auto flex flex-col gap-3 pt-6">
                    <p className="text-center text-xs text-muted-foreground">{t('plan.overview.switchHint')}</p>
                    {state.cancelPhase && (
                        <button type="button" onClick={onCancel} className="text-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                            {t('plan.overview.cancelPlan')}
                        </button>
                    )}
                </div>
            </div>
        </>
    )
}

// What switching the billing or the app slots would do, quoted before anything is applied.
function ChangePane({
    state,
    currentBillCents,
    selection,
    onReset,
    onDone,
}: {
    state: SubscriptionState
    currentBillCents: number
    selection: PlanSelection
    onReset: () => void
    onDone: (success: Success) => void
}) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const errorText = useErrorText()
    const [accepted, setAccepted] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const slots = appSlotsOf(selection.quantities)
    const currentSlots = appSlotsOf(state.quantities)
    const planLabel = (slotCounts: AppSlots) => t('plan.change.planLabel', { slots: appSlotsLabel(slotCounts, t) })
    const changedApps = APP_SLUGS.filter(slug => slots[slug] !== currentSlots[slug])
    const interval = selection.interval
    const newBillCents = planBillCents(state, selection.quantities, interval)
    const newBill = billed(newBillCents, interval, t)
    const renewal = state.periodEnd ? shortDate(state.periodEnd, locale) : t('plan.yourRenewal')
    const switchingDown = state.interval === 'yearly' && interval === 'monthly'
    const switchingUp = state.interval === 'monthly' && interval === 'yearly'
    const increase = APP_SLUGS.some(slug => slots[slug] > currentSlots[slug])
    const chargesToday = switchingUp || increase

    const quote = usePlanQuote(selection, chargesToday)

    const apply = async () => {
        setSubmitting(true)
        setError(null)
        const result = await runPlanChange(selection)
        setSubmitting(false)
        if (!result.ok) return setError(errorText(result))
        if (result.switchAt) return onDone({ title: t('plan.change.switchScheduledTitle'), body: t('plan.change.switchScheduledBody', { date: shortDate(result.switchAt, locale) }) })
        if (!chargesToday) return onDone({ title: t('plan.change.changeScheduledTitle'), body: t('plan.change.changeScheduledBody', { current: planLabel(currentSlots), renewal, next: planLabel(slots), price: newBill }) })
        onDone({ title: t('plan.change.planUpdatedTitle'), body: t(interval === 'yearly' ? 'plan.change.planUpdatedBodyYearly' : 'plan.change.planUpdatedBodyMonthly', { plan: planLabel(slots) }) })
    }

    const newBillFlow = <BilledFlow cents={newBillCents} interval={interval} />
    const onlySlots = !switchingUp && !switchingDown
    const title = switchingDown
        ? t('plan.change.switchToMonthly')
        : onlySlots && changedApps.length === 1
          ? t.rich('plan.change.changeToSlots', { count: slots[changedApps[0]], provider: appInfo(changedApps[0]).providerLabel, n: () => <CountFlow value={slots[changedApps[0]]} /> })
          : onlySlots
            ? t('plan.change.changeAppSlots')
            : t('plan.change.switchToYearly')
    const quoteValue = (cents: number | undefined) => (quote === 'loading' ? <Skeleton className="inline-block h-4 w-14" /> : cents == null ? '-' : usd(cents))

    const rows = chargesToday
        ? [
              { label: t(interval === 'yearly' ? 'plan.change.proLineYearly' : 'plan.change.proLineMonthly', { plan: planLabel(slots) }), value: newBillFlow },
              ...(switchingUp
                  ? [
                        {
                            label: t(state.interval === 'yearly' ? 'plan.change.unusedTimeYearly' : 'plan.change.unusedTimeMonthly'),
                            value: quote && quote !== 'loading' ? `-${usd(quote.unusedCreditCents)}` : quoteValue(undefined),
                            muted: true,
                        },
                    ]
                  : []),
              { label: t('plan.change.dueTodayTaxIncluded'), value: quoteValue(quote && quote !== 'loading' ? quote.dueTodayCents : undefined), strong: true },
              ...(switchingDown ? [{ label: t('plan.change.from', { date: renewal }), value: t.rich('plan.change.monthlyFrom', { price: () => newBillFlow }), muted: true }] : []),
          ]
        : [
              { label: t('plan.change.until', { date: renewal }), value: `${planLabel(currentSlots)} · ${billed(currentBillCents, state.interval, t)}` },
              {
                  label: t('plan.change.from', { date: renewal }),
                  value: (
                      <>
                          {planLabel(slots)} · {newBillFlow}
                      </>
                  ),
                  strong: true,
              },
          ]

    return (
        <>
            <RightTitle onBack={onReset} backLabel={t('plan.change.keepMyPlan')}>
                {title}
            </RightTitle>
            <div className="mt-6 flex flex-col gap-3">
                <SummaryRows rows={rows} />
                {chargesToday && <CardOnFile card={state.card} />}
            </div>
            <PayFooter
                cta={chargesToday ? t('plan.change.confirmAndPay') : switchingDown ? t('plan.change.switchOn', { date: renewal }) : t('plan.change.scheduleFor', { date: renewal })}
                footnote={
                    chargesToday
                        ? switchingDown
                            ? t('plan.change.billedNowSlots', { date: renewal })
                            : onlySlots
                              ? t('plan.change.slotsReady')
                              : t('plan.change.yearlyStarts')
                        : t('plan.change.nothingToday')
                }
                onClick={() => void apply()}
                loading={submitting}
                disabled={(chargesToday && (!accepted || quote === 'loading'))}
                disabledReason={!accepted ? t('plan.acceptTerms') : undefined}
                error={error}
            >
                {chargesToday && <TermsConsent checked={accepted} onChange={setAccepted} />}
            </PayFooter>
        </>
    )
}

function CancelPendingPane({ state, currentBillCents, onResumed }: { state: SubscriptionState; currentBillCents: number; onResumed: () => void }) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const errorText = useErrorText()
    const [resuming, setResuming] = useState(false)
    const ends = state.periodEnd ? shortDate(state.periodEnd, locale) : t('plan.cancelPending.endOfPeriod')

    const resume = async () => {
        setResuming(true)
        const result = await resumeSubscriptionAction()
        setResuming(false)
        if (!result.ok) return toast.error(t('plan.cancelPending.resumeFailed'), { description: errorText(result) })
        onResumed()
    }

    return (
        <>
            <RightTitle>{t('plan.cancelPending.title', { date: ends })}</RightTitle>
            <div className="mt-6 flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">{t('plan.cancelPending.body')}</p>
                <SummaryRows rows={[{ label: t('plan.nextInvoice'), value: t('plan.cancelPending.none'), muted: true }]} />
            </div>
            <PayFooter cta={t('plan.cancelPending.resume')} footnote={t('plan.cancelPending.footnote', { price: billed(currentBillCents, state.interval, t), date: ends })} onClick={() => void resume()} loading={resuming} />
        </>
    )
}

// --- The card: a setup session in the app's own UI, for a new card or a failed payment ---

function useSetupSession(): { clientSecret: string; sessionId: string } | { error: string } | null {
    const [session, setSession] = useState<{ clientSecret: string; sessionId: string } | { error: string } | null>(null)
    const errorText = useErrorText()
    useEffect(() => {
        let cancelled = false
        createPlanCardSetupAction().then(result => {
            if (cancelled) return
            setSession(result.ok ? { clientSecret: result.clientSecret, sessionId: result.sessionId } : { error: errorText(result) })
        })
        return () => {
            cancelled = true
        }
    }, [errorText])
    return session
}

function SetupForm({ sessionId, cta, footnote, onSaved }: { sessionId: string; cta: string; footnote?: string; onSaved: () => void }) {
    const t = useTranslations('billing')
    const errorText = useErrorText()
    const checkout = useCheckout()
    const loaded = checkout.type === 'success' ? checkout.checkout : null
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const save = async (expressCheckoutConfirmEvent?: StripeExpressCheckoutElementConfirmEvent) => {
        if (!loaded || submitting) return
        setSubmitting(true)
        setError(null)
        try {
            const result = await loaded.confirm({ redirect: 'if_required', expressCheckoutConfirmEvent })
            if (result.type === 'error') throw new Error(result.error.message)
            const saved = await confirmCardSetupAction(sessionId)
            if (!saved.ok) throw new Error(errorText(saved))
            onSaved()
        } catch (err) {
            setError(err instanceof Error ? err.message : t('plan.card.notSaved'))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <>
            <div className="mt-6">
                <StripePaymentFields wallet={{ onConfirm: event => void save(event), disabledReason: submitting ? t('plan.pleaseWait') : undefined }} />
            </div>
            <PayFooter cta={cta} footnote={footnote} onClick={() => void save()} loading={submitting} disabled={!loaded} error={error} />
        </>
    )
}

function SetupSessionPane({ children }: { children: (sessionId: string) => ReactNode }) {
    const session = useSetupSession()
    if (!session) return <StripePaymentFieldsSkeleton />
    if ('error' in session) return <Notice tone="danger">{session.error}</Notice>
    return <StripeCheckoutProvider clientSecret={session.clientSecret}>{children(session.sessionId)}</StripeCheckoutProvider>
}

function CardPane({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
    const t = useTranslations('billing.plan.card')
    return (
        <>
            <RightTitle onBack={onBack}>{t('title')}</RightTitle>
            <SetupSessionPane>{sessionId => <SetupForm sessionId={sessionId} cta={t('save')} footnote={t('footnote')} onSaved={onSaved} />}</SetupSessionPane>
        </>
    )
}

function PastDuePane({ state, onDone }: { state: SubscriptionState; onDone: () => void }) {
    const locale = useLocale()
    const t = useTranslations('billing.plan')
    const { access } = useWorkspaceAccess()
    const due = state.openInvoice ? usd(state.openInvoice.amountCents) : null
    return (
        <>
            <RightTitle>{t('card.title')}</RightTitle>
            <div className="mt-6">
                <Notice tone="danger">
                    {due
                        ? state.openInvoice
                            ? t('pastDue.declinedOn', { amount: due, date: shortDate(state.openInvoice.createdAt, locale) })
                            : t('pastDue.declined', { amount: due })
                        : t('pastDue.lastDeclined')}{' '}
                    {access === 'paused' ? t('pastDue.paused') : t('pastDue.keepRunning')}
                </Notice>
            </div>
            <SetupSessionPane>{sessionId => <SetupForm sessionId={sessionId} cta={due ? t('pastDue.ctaAmount', { amount: due }) : t('pastDue.cta')} onSaved={onDone} />}</SetupSessionPane>
        </>
    )
}

function InvoicesPane({ onBack }: { onBack: () => void }) {
    const locale = useLocale()
    const t = useTranslations('billing.plan.invoices')
    const errorText = useErrorText()
    const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null)

    useEffect(() => {
        let cancelled = false
        listInvoicesAction().then(result => {
            if (cancelled) return
            if (!result.ok) toast.error(t('loadFailed'), { description: errorText(result) })
            setInvoices(result.ok ? result.invoices : [])
        })
        return () => {
            cancelled = true
        }
    }, [])

    return (
        <>
            <RightTitle onBack={onBack}>{t('title')}</RightTitle>
            <div className="mt-6 flex flex-col divide-y divide-border rounded-xl bg-background/60 ring-1 ring-border">
                {invoices === null
                    ? Array.from({ length: 4 }, (_, index) => (
                          <div key={index} className="flex items-center justify-between px-4 py-3">
                              <Skeleton className="h-4 w-24" />
                              <Skeleton className="h-4 w-16" />
                          </div>
                      ))
                    : invoices.length === 0
                      ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
                      : invoices.map(invoice => (
                            <a
                                key={invoice.id}
                                href={invoice.pdfUrl ?? invoice.hostedUrl ?? undefined}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-background"
                            >
                                <span>{longDate(invoice.createdAt, locale)}</span>
                                <span className="flex items-center gap-3">
                                    {invoice.status !== 'paid' && <span className="text-xs text-muted-foreground capitalize">{invoiceStatusLabel(invoice.status, t)}</span>}
                                    <span className="tabular-nums">{usd(invoice.amountCents)}</span>
                                    <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
                                </span>
                            </a>
                        ))}
            </div>
        </>
    )
}

const INVOICE_STATUSES = ['draft', 'open', 'uncollectible', 'void'] as const

function invoiceStatusLabel(status: string, t: ReturnType<typeof useTranslations<'billing.plan.invoices'>>): string {
    const known = INVOICE_STATUSES.find(candidate => candidate === status)
    return known ? t(`status.${known}`) : status
}

