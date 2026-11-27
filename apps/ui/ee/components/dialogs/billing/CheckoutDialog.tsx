'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { APP_INFO } from '@/lib/apps/catalog'
import { APP_ADDON_KEYS, APP_SLUGS } from '@/lib/apps/types'
import { useCheckout } from '@stripe/react-stripe-js/checkout'
import type { StripeExpressCheckoutElementConfirmEvent } from '@stripe/stripe-js'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { confirmCardSetupAction, createPlanCardSetupAction, resumeSubscriptionAction } from '@/ee/actions/billing.actions'
import { runPlanChange } from '@/ee/lib/billing/plan-payment'
import type { FullPlanSelection, SubscriptionState } from '@/ee/services/billing.service'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import type { CheckoutRoute } from '@/ee/lib/billing/checkout-variant'
import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { BASE_PLAN_CREDITS, INCLUDED_MACHINE_SIZE, PLAN_PRICES_CENTS, TRIAL_ACTIVE_AGENTS, TRIAL_CREDITS, ZERO_QUANTITIES, planPriceCents, trialEndDate, type BillingInterval } from '@/ee/lib/billing/plans'
import { TRIAL_ENDING_LEAD_MS } from '@/ee/lib/lifecycle/sequences'
import { useStartPending } from '@/lib/onboarding/useStartPending'
import { AGENT_LIMIT_TRIGGER, useBillingStore, type BillingUpgrade } from '@/stores/billing.store'
import { useForemanStore } from '@/stores/foreman.store'
import { hasPendingStart, useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'

import { BillingDialogShell } from './BillingDialogShell'
import { CreditCard } from './credit-usage/CreditCard'
import { UsagePane } from './credit-usage/UsagePane'
import { useCreditUsage } from './credit-usage/useCreditUsage'
import { PerksComparison } from './PerksComparison'
import { checkoutCopy, longDate, nextInvoiceDate, shortDate, type BillingTranslator, type CheckoutContext } from './checkout-copy'
import { BilledFlow, CardOnFile, Headline, IntervalToggle, PayFooter, PayHeader, PlanCard, RightTitle, SuccessPanel, SummaryRows, TermsConsent, TestimonialStrip, Timeline, UsdFlow, usd } from './parts'
import { StripeCheckoutProvider, StripePaymentFields } from './StripeCheckout'
import { PaneError, PaneSkeleton, SubscribePane, errorMessage, type PaneCopy } from './SubscribeCheckout'
import { usePlanQuote } from './usePlanQuote'

// The yearly price is what the dialog opens on, as designed; the toggle is one click away. Not during
// a trial: subscribing ends it and bills today, and a year upfront is not what a trial user expects.
const DEFAULT_INTERVAL: BillingInterval = 'yearly'

type Done = 'paid' | 'card_saved' | 'trial_started' | 'restoring'

const DAY_MS = 86_400_000

// A plan already running keeps its add-ons and its machine size: an app slot put on during the trial
// would otherwise be dropped by the change that ends it.
function selectionOf(interval: BillingInterval, state: SubscriptionState | null): FullPlanSelection {
    return { quantities: state?.quantities ?? ZERO_QUANTITIES, interval, machineSize: state?.machineSize ?? INCLUDED_MACHINE_SIZE }
}

function billedLabel(t: BillingTranslator, interval: BillingInterval): ReactNode {
    const amount = usd(planPriceCents(ZERO_QUANTITIES, interval))
    return t.rich(interval === 'yearly' ? 'parts.interval.perYear' : 'parts.interval.perMonth', { amount: () => amount })
}

// A year from now reads with its year: "Oct 2" alone would read as today.
function invoiceDateLabel(interval: BillingInterval, locale: string): string {
    const date = nextInvoiceDate(interval)
    return interval === 'yearly' ? longDate(date, locale) : shortDate(date, locale)
}

export function CheckoutDialog({
    route,
    state,
    onClose,
    onCancelTrial,
    onChanged,
    onTrialRefused,
}: {
    route: CheckoutRoute
    state: SubscriptionState | null
    onClose: () => void
    onCancelTrial: () => void
    onChanged: () => void
    onTrialRefused: () => void
}) {
    const t = useTranslations('billing')
    const locale = useLocale()
    const { workspace, refreshWorkspace } = useSession()
    const { keptUntil } = useWorkspaceAccess()
    const parkedTemplate = useOnboardingStore(s => s.pendingTemplate)
    const parked = useOnboardingStore(s => hasPendingStart(s))
    const startPending = useStartPending()
    const fixedPlan = route.variant === 'start_trial'
    const [interval, setBillingInterval] = useState<BillingInterval>(fixedPlan || workspace?.subscription_status === 'trialing' ? 'monthly' : DEFAULT_INTERVAL)
    const [done, setDone] = useState<Done | null>(null)
    const [placing, setPlacing] = useState(false)
    // Sent here by the trial's coworker cap: what lifts it is paying now, so the dialog opens on that.
    const [payNow, setPayNow] = useState(() => route.variant === 'trial_card' && useBillingStore.getState().trigger === AGENT_LIMIT_TRIGGER)
    const [usageOpen, setUsageOpen] = useState(false)
    const [newCard, setNewCard] = useState(false)
    const upgrade = useBillingStore(s => s.upgrade)
    const creditLocked = route.variant === 'credit_locked'
    const credit = useCreditUsage({ enabled: workspace?.subscription_status === 'trialing' })
    const [openedAt] = useState(() => Date.now())

    // A card trial opens on the trial itself, nothing due today: paying before its end is one step further.
    const trialView = route.variant === 'trial_card' && !payNow
    const planFixed = fixedPlan || trialView
    const trialEndsAt = workspace?.trial_ends_at ? new Date(workspace.trial_ends_at) : null
    const reminderAt = trialEndsAt ? new Date(trialEndsAt.getTime() - TRIAL_ENDING_LEAD_MS) : null
    const firstChargeCents = state?.nextInvoice?.amountCents ?? planPriceCents(state?.quantities ?? ZERO_QUANTITIES, state?.interval ?? 'monthly', state?.machineSize)
    const startTrialEnds = trialEndDate(new Date(openedAt))
    const context: CheckoutContext = {
        billed: <BilledFlow cents={planPriceCents(ZERO_QUANTITIES, interval)} interval={interval} />,
        nextInvoice: invoiceDateLabel(interval, locale),
        trialEnds: route.variant === 'start_trial' ? shortDate(startTrialEnds, locale) : trialEndsAt ? shortDate(trialEndsAt, locale) : null,
        trialDaysLeft: trialEndsAt ? Math.ceil((trialEndsAt.getTime() - openedAt) / DAY_MS) : null,
        reminderOn: reminderAt && reminderAt.getTime() > openedAt ? shortDate(reminderAt, locale) : null,
        firstCharge: usd(firstChargeCents),
        trialCancelled: !!state?.cancelAtPeriodEnd,
        keptUntil: keptUntil ? longDate(keptUntil, locale) : null,
        parked: parkedTemplate ? { title: parkedTemplate.title, agentCount: parkedTemplate.agentCount } : null,
        coworker: upgrade?.coworker ?? null,
    }
    const copy = checkoutCopy(t, route.variant === 'trial_card' && payNow ? 'trial_card_pay_now' : route.variant, context)
    const selection = selectionOf(interval, state)

    // On a trial, more credit comes with Pro: the card's button leads to paying now, or back to the
    // pane that already sells it.
    const startProNow = () => {
        setUsageOpen(false)
        if (route.variant === 'trial_card') setPayNow(true)
    }

    const finish = async (outcome: Done) => {
        // The stopped task picks back up behind the dialog, whether it is then closed or clicked through.
        if (outcome === 'paid') upgrade?.onPaid?.()
        await refreshWorkspace()
        onChanged()
        // Arrived on a template or a shared coworker: the column installs it the moment the plan is
        // on, so the dialog gets out of the way instead of asking for a click that starts nothing.
        if (useForemanStore.getState().arrival) return onClose()
        setDone(outcome)
    }

    // Once paid, the trial badge would count down days of a trial that just ended.
    const intro = <Headline badge={done === 'paid' ? undefined : copy.badge} title={copy.title} subtitle={copy.subtitle} />
    const left = (
        <>
            <Timeline steps={copy.timeline} />
            <div className="mt-6 mb-4 flex flex-col gap-3">
                {!planFixed && <IntervalToggle value={interval} onChange={setBillingInterval} disabled={!!done} />}
                {creditLocked ? (
                    <PerksComparison />
                ) : (
                    <>
                        <PlanCard interval={planFixed ? 'monthly' : interval} freeTrial={planFixed} />
                        {credit.trial && <CreditCard credit={credit} onAdd={startProNow} onOpenUsage={done ? undefined : () => setUsageOpen(true)} />}
                    </>
                )}
            </div>
            <TestimonialStrip />
        </>
    )

    if (done) {
        const entitled = isSubscriptionEntitled(workspace?.subscription_status)
        const placeLabel = parkedTemplate ? (parkedTemplate.agentCount > 1 ? t('checkout.success.placeCoworkers', { count: parkedTemplate.agentCount }) : t('checkout.success.placeOnBoard')) : t('checkout.success.startCoworker')
        const onDone = async () => {
            if (!parked) return onClose()
            setPlacing(true)
            try {
                await startPending()
                onClose()
            } finally {
                setPlacing(false)
            }
        }
        const success = creditLocked && done === 'paid' ? creditUnlockedCopy(t, interval, upgrade, locale) : successCopy(t, done, { interval, trialEnds: context.trialEnds, firstCharge: context.firstCharge, locale })
        return (
            <BillingDialogShell
                title={success.title}
                mobileOrder="payment-first"
                intro={intro}
                left={left}
                right={<SuccessPanel {...success} cta={parked ? placeLabel : success.cta} onDone={() => void onDone()} loading={placing || (parked && !entitled)} />}
            />
        )
    }

    const right = (() => {
        if (usageOpen) return <UsagePane credit={credit} onBack={() => setUsageOpen(false)} backLabel={trialView ? t('checkout.usageBack.trial') : t('checkout.usageBack.back')} />
        switch (route.payment) {
            case 'subscribe':
                return <SubscribePane key={route.variant} selection={selection} copy={copy} onDone={trialStarted => void finish(route.variant === 'paused' ? 'restoring' : trialStarted ? 'trial_started' : 'paid')} onTrialRefused={onTrialRefused} />
            case 'card_form':
                return <CardFormPane selection={selection} copy={copy} trialEnds={context.trialEnds} onDone={outcome => void finish(outcome)} />
            case 'card_on_file':
                if (newCard) return <CardFormPane selection={selection} copy={copy} trialEnds={context.trialEnds} onDone={outcome => void finish(outcome)} />
                if (trialView) return <TrialPane state={state} copy={copy} trialEnds={context.trialEnds} reminderOn={context.reminderOn} firstCharge={context.firstCharge} onContinue={onClose} onCancelTrial={onCancelTrial} onPayNow={() => setPayNow(true)} onResumed={onChanged} />
                return (
                    <CardOnFilePane
                        selection={selection}
                        state={state}
                        copy={copy}
                        trialEnds={context.trialEnds}
                        onBack={route.variant === 'trial_card' ? () => setPayNow(false) : undefined}
                        onChangeCard={creditLocked ? () => setNewCard(true) : undefined}
                        onDone={() => void finish('paid')}
                        onCancelTrial={onCancelTrial}
                        onResumed={onChanged}
                    />
                )
        }
    })()

    return <BillingDialogShell title={copy.title} mobileOrder={planFixed ? 'payment-first' : 'plan-first'} intro={intro} left={left} right={right} />
}

function successCopy(t: BillingTranslator, done: Done, { interval, trialEnds, firstCharge, locale }: { interval: BillingInterval; trialEnds: string | null; firstCharge: string; locale: string }) {
    const next = (
        <>
            {invoiceDateLabel(interval, locale)} · {billedLabel(t, interval)}
        </>
    )
    const planRow = { label: t('checkout.success.plan'), value: t('checkout.success.planValue') }
    const planRows = [planRow, { label: t('checkout.success.nextInvoice'), value: next }]
    const chargeDate = trialEnds ?? t('checkout.success.lastDayFallback')
    switch (done) {
        case 'paid':
            return { title: t('checkout.success.paid.title'), body: t('checkout.success.paid.body'), rows: planRows, cta: t('checkout.success.backToBoard') }
        case 'card_saved':
            return {
                title: t('checkout.success.cardSaved.title'),
                body: t('checkout.success.cardSaved.body', { date: chargeDate, charge: firstCharge }),
                rows: [planRow],
                cta: t('checkout.success.backToBoard'),
            }
        case 'trial_started':
            return { title: t('checkout.success.trialStarted.title'), body: t('checkout.success.trialStarted.body', { charge: firstCharge, date: chargeDate }), cta: t('checkout.success.trialStarted.cta') }
        case 'restoring':
            return { title: t('checkout.success.restoring.title'), body: t('checkout.success.restoring.body'), rows: planRows, cta: t('checkout.success.backToBoard') }
    }
}

// Paying from a chat that ran out of trial credit: what came with Pro, and the way back to the task.
function creditUnlockedCopy(t: BillingTranslator, interval: BillingInterval, upgrade: BillingUpgrade | null, locale: string) {
    return {
        title: t('checkout.success.paid.title'),
        body: upgrade?.coworker ? t('checkout.success.creditUnlocked.body', { coworker: upgrade.coworker }) : t('checkout.success.creditUnlocked.bodyNoCoworker'),
        rows: [
            { label: t('checkout.success.creditUnlocked.credits'), value: t('checkout.success.creditUnlocked.creditsValue', { credits: BASE_PLAN_CREDITS }) },
            { label: t('checkout.success.creditUnlocked.coworkers'), value: t('checkout.success.creditUnlocked.coworkersValue') },
            {
                label: t('checkout.success.nextInvoice'),
                value: (
                    <>
                        {invoiceDateLabel(interval, locale)} · {billedLabel(t, interval)}
                    </>
                ),
            },
        ],
        cta: upgrade?.onPaid ? t('checkout.success.creditUnlocked.resume') : t('checkout.success.backToBoard'),
    }
}

type SessionState = { clientSecret: string; sessionId: string } | { error: string } | null

// --- A trial without a card: the card form, then paying now or at the end of the trial ---

function CardFormPane({ selection, copy, trialEnds, onDone }: { selection: FullPlanSelection; copy: PaneCopy; trialEnds: string | null; onDone: (outcome: 'paid' | 'card_saved') => void }) {
    const [session, setSession] = useState<SessionState>(null)
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
    }, [])

    if (!session) return <PaneSkeleton />
    if ('error' in session) return <PaneError message={session.error} />

    return (
        <StripeCheckoutProvider clientSecret={session.clientSecret}>
            <CardForm sessionId={session.sessionId} selection={selection} copy={copy} trialEnds={trialEnds} onDone={onDone} />
        </StripeCheckoutProvider>
    )
}

function CardForm({ sessionId, selection, copy, trialEnds, onDone }: { sessionId: string; selection: FullPlanSelection; copy: PaneCopy; trialEnds: string | null; onDone: (outcome: 'paid' | 'card_saved') => void }) {
    const t = useTranslations('billing')
    const errorText = useErrorText()
    const checkout = useCheckout()
    const loaded = checkout.type === 'success' ? checkout.checkout : null
    const [accepted, setAccepted] = useState(false)
    const [submitting, setSubmitting] = useState<'now' | 'later' | null>(null)
    const [error, setError] = useState<string | null>(null)
    const interval = selection.interval

    const save = async (when: 'now' | 'later', expressCheckoutConfirmEvent?: StripeExpressCheckoutElementConfirmEvent) => {
        if (!loaded || submitting) return
        setSubmitting(when)
        setError(null)
        try {
            const result = await loaded.confirm({ redirect: 'if_required', expressCheckoutConfirmEvent })
            if (result.type === 'error') throw new Error(result.error.message)
            const saved = await confirmCardSetupAction(sessionId)
            if (!saved.ok) throw new Error(errorText(saved))
            if (when === 'later') return onDone('card_saved')

            const changed = await runPlanChange(selection)
            if (!changed.ok) throw new Error(copy.refusal ? copy.refusal(errorText(changed)) : errorText(changed))
            onDone('paid')
        } catch (err) {
            setError(errorMessage(err, t('checkout.pay.genericError')))
        } finally {
            setSubmitting(null)
        }
    }

    return (
        <>
            <PayHeader title={t('checkout.pay.subscribe')} amount={<UsdFlow cents={planPriceCents(selection.quantities, interval, selection.machineSize)} />} unit={interval === 'yearly' ? t('checkout.pay.perYear') : t('checkout.pay.perMonth')} />
            <p className="mt-2 text-sm text-muted-foreground">{t('checkout.card.exclVat')}</p>
            <div className="mt-6">
                <StripePaymentFields wallet={{ onConfirm: event => void save('now', event), disabledReason: !accepted ? t('checkout.pay.acceptTerms') : submitting ? t('checkout.pay.pleaseWait') : undefined }} />
            </div>
            <PayFooter
                cta={copy.cta}
                onClick={() => void save('now')}
                loading={submitting === 'now'}
                disabled={!loaded || !accepted || !!submitting}
                disabledReason={!accepted ? t('checkout.pay.acceptTerms') : undefined}
                error={error}
                footnote={t.rich('checkout.card.payLaterFootnote', {
                    later: () => (
                        <button type="button" disabled={!loaded || !!submitting} onClick={() => void save('later')} className="text-foreground underline underline-offset-4 disabled:opacity-60">
                            {submitting === 'later' ? t('checkout.card.saving') : trialEnds ? t('checkout.card.payOn', { date: trialEnds }) : t('checkout.card.payOnLastDay')}
                        </button>
                    ),
                })}
            >
                <TermsConsent checked={accepted} onChange={setAccepted} />
            </PayFooter>
        </>
    )
}

// --- A trial with a card: the right column is the bill, paying is one click ---

function CardOnFilePane({
    selection,
    state,
    copy,
    trialEnds,
    onBack,
    onChangeCard,
    onDone,
    onCancelTrial,
    onResumed,
}: {
    selection: FullPlanSelection
    state: SubscriptionState | null
    copy: PaneCopy
    trialEnds: string | null
    onBack?: () => void
    onChangeCard?: () => void
    onDone: () => void
    onCancelTrial: () => void
    onResumed: () => void
}) {
    const t = useTranslations('billing')
    const errorText = useErrorText()
    const quote = usePlanQuote(selection, true)
    const [accepted, setAccepted] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const interval = selection.interval

    const start = async () => {
        if (submitting) return
        setSubmitting(true)
        setError(null)
        const result = await runPlanChange(selection)
        setSubmitting(false)
        if (!result.ok) return setError(copy.refusal ? copy.refusal(errorText(result)) : errorText(result))
        onDone()
    }

    const listCents = planPriceCents(selection.quantities, interval, selection.machineSize)
    const dueToday = quote === 'loading' ? null : usd(quote?.dueTodayCents ?? listCents)
    const amount = dueToday ?? <Skeleton className="inline-block h-7 w-24 align-middle" />

    if (state?.cancelAtPeriodEnd) return <TrialCancelledPane trialEnds={trialEnds} onResumed={onResumed} />

    return (
        <>
            {onBack && (
                <div className="mb-5">
                    <RightTitle onBack={onBack} backLabel={t('checkout.cardOnFile.back')}>
                        {t('checkout.cardOnFile.title')}
                    </RightTitle>
                </div>
            )}
            <PayHeader title={t('checkout.cardOnFile.header')} amount={amount} unit={t('checkout.pay.dueToday')} />
            <div className="mt-6 flex flex-col gap-3">
                <SummaryRows
                    rows={[
                        { label: t('checkout.success.planValue'), value: <BilledFlow cents={listCents} interval={interval} /> },
                        {
                            label: quote && quote !== 'loading' && quote.taxIncluded ? t('checkout.cardOnFile.tax') : t('checkout.cardOnFile.taxFromAddress'),
                            value: quote === 'loading' ? <Skeleton className="inline-block h-4 w-12" /> : quote ? usd(quote.taxCents) : '-',
                            muted: true,
                        },
                        { label: t('checkout.cardOnFile.dueToday'), value: amount, strong: true },
                    ]}
                />
                <CardOnFile card={state?.card ?? null} action={onChangeCard && t('checkout.cardOnFile.change')} onAction={onChangeCard} />
            </div>
            <PayFooter
                cta={copy.payCta && dueToday ? copy.payCta(dueToday) : copy.cta}
                footnote={copy.footnote}
                onClick={() => void start()}
                loading={submitting}
                disabled={!accepted}
                disabledReason={t('checkout.pay.acceptTerms')}
                error={error}
            >
                <TermsConsent checked={accepted} onChange={setAccepted} />
            </PayFooter>
            {state?.cancelPhase === 'trial' && (
                <button type="button" onClick={onCancelTrial} className="mt-3 text-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                    {t('checkout.cancelTrial')}
                </button>
            )}
        </>
    )
}

// --- A trial with a card, as opened from the pill: what it costs today, when the card is charged ---

function TrialPane({
    state,
    copy,
    trialEnds,
    reminderOn,
    firstCharge,
    onContinue,
    onCancelTrial,
    onPayNow,
    onResumed,
}: {
    state: SubscriptionState | null
    copy: PaneCopy
    trialEnds: string | null
    reminderOn: string | null
    firstCharge: ReactNode
    onContinue: () => void
    onCancelTrial: () => void
    onPayNow: () => void
    onResumed: () => void
}) {
    const t = useTranslations('billing')
    if (state?.cancelAtPeriodEnd) return <TrialCancelledPane trialEnds={trialEnds} onResumed={onResumed} />

    const chargeDate = trialEnds ?? t('checkout.trialEndFallback')
    return (
        <>
            <PayHeader title={t('checkout.trial.title')} amount={usd(0)} unit={t('checkout.pay.dueToday')} />
            <div className="mt-6 flex flex-col gap-3">
                <SummaryRows
                    rows={[
                        { label: t('checkout.trial.included'), value: t('checkout.trial.includedValue', { agents: TRIAL_ACTIVE_AGENTS, credits: TRIAL_CREDITS }) },
                        ...APP_SLUGS.flatMap(slug => {
                            const count = state?.quantities[APP_ADDON_KEYS[slug]] ?? 0
                            if (!state || count === 0) return []
                            const cents = count * PLAN_PRICES_CENTS[state.interval][APP_ADDON_KEYS[slug]]
                            const values = { amount: usd(cents), date: chargeDate }
                            return [
                                {
                                    label: t('checkout.trial.slots', { provider: APP_INFO[slug].providerLabel, count }),
                                    value: state.interval === 'yearly' ? t('checkout.trial.slotPriceYearly', values) : t('checkout.trial.slotPriceMonthly', values),
                                },
                            ]
                        }),
                        { label: t('checkout.trial.ends'), value: chargeDate },
                        ...(reminderOn ? [{ label: t('checkout.trial.reminder'), value: reminderOn }] : []),
                        { label: t('checkout.trial.firstCharge'), value: t.rich('checkout.trial.firstChargeValue', { charge: () => firstCharge, date: chargeDate }), strong: true },
                    ]}
                />
                <CardOnFile card={state?.card ?? null} />
                <p className="text-sm text-muted-foreground">{t('checkout.trial.cancelBefore', { date: chargeDate })}</p>
            </div>
            <PayFooter cta={copy.cta} onClick={onPayNow} />
            <Button variant="outline" size="lg" className="mt-3 h-11 w-full text-base" onClick={onContinue}>
                {t('checkout.trial.continue')}
            </Button>
            {state?.cancelPhase === 'trial' && (
                <button type="button" onClick={onCancelTrial} className="mt-4 text-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                    {t('checkout.cancelTrial')}
                </button>
            )}
        </>
    )
}

function TrialCancelledPane({ trialEnds, onResumed }: { trialEnds: string | null; onResumed: () => void }) {
    const t = useTranslations('billing')
    const errorText = useErrorText()
    const [resuming, setResuming] = useState(false)

    const resume = async () => {
        setResuming(true)
        const result = await resumeSubscriptionAction()
        setResuming(false)
        if (!result.ok) return toast.error(t('checkout.trialCancelled.resumeFailed'), { description: errorText(result) })
        onResumed()
    }

    return (
        <>
            <PayHeader title={t('checkout.trialCancelled.title')} amount={trialEnds ?? ''} unit={t('checkout.trialCancelled.unit')} />
            <p className="mt-6 text-sm text-muted-foreground">{t('checkout.trialCancelled.body')}</p>
            <PayFooter cta={t('checkout.trialCancelled.resume')} onClick={() => void resume()} loading={resuming} />
        </>
    )
}
