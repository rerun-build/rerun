'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useCheckout } from '@stripe/react-stripe-js/checkout'
import type { StripeExpressCheckoutElementConfirmEvent } from '@stripe/stripe-js'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { acceptPlanTermsAction, createPlanCheckoutAction, readCheckoutOutcomeAction, updatePlanCheckoutAction } from '@/ee/actions/billing.actions'
import type { PlanSelection } from '@/ee/services/billing.service'
import { Skeleton } from '@/components/ui/skeleton'
import { TRIAL_DAYS, planPriceCents, trialEndDate, type PriceArm } from '@/ee/lib/billing/plans'

import { shortDate } from './checkout-copy'
import { PayFooter, PayHeader, SummaryRows, TermsConsent, UsdFlow, usd } from './parts'
import { StripeCheckoutProvider, StripePaymentFields, StripePaymentFieldsSkeleton, StripePromoCode } from './StripeCheckout'
import { usePendingReferrer } from './referrals/usePendingReferrer'

const OUTCOME_POLL_MS = 2_000
const OUTCOME_TIMEOUT_MS = 30_000
const SELECTION_DEBOUNCE_MS = 250

export type PaneCopy = { cta: string; payCta?: (amount: string) => string; refusal?: (message: string) => string; footnote?: string }

// What the pay button needs, for a surface that lays it out its own way. `consent` is the terms box,
// which has to be ticked before it.
export type SubscribeSubmit = {
    cta: string
    footnote: ReactNode
    onClick: () => void
    loading: boolean
    disabled: boolean
    disabledReason?: string
    error: ReactNode
    consent: ReactNode
}

export type SubscribeFooter = (submit: SubscribeSubmit) => ReactNode

function defaultFooter({ consent, ...submit }: SubscribeSubmit) {
    return <PayFooter {...submit}>{consent}</PayFooter>
}

export function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
}

// --- A new subscription: the plan Checkout, the card form in this column ---

// The server decides whether the session carries the trial, so "$0 due today" is read off the session
// it created rather than off the variant the browser guessed.
type PlanSessionState = { clientSecret: string; sessionId: string; trial: boolean } | { error: string } | null

export function SubscribePane({
    selection,
    priceArm,
    copy,
    onDone,
    onTrialRefused,
    footer,
}: {
    selection: PlanSelection
    priceArm: PriceArm
    copy: PaneCopy
    onDone: (trialStarted: boolean) => void
    onTrialRefused: () => void
    footer?: SubscribeFooter
}) {
    const t = useTranslations('billing')
    const [session, setSession] = useState<PlanSessionState>(null)
    const errorText = useErrorText()
    const [sessionSelection] = useState(selection)

    useEffect(() => {
        let cancelled = false
        createPlanCheckoutAction(sessionSelection).then(result => {
            if (cancelled) return
            setSession(result.ok ? { clientSecret: result.clientSecret, sessionId: result.sessionId, trial: result.trial } : { error: errorText(result) })
        })
        return () => {
            cancelled = true
        }
    }, [sessionSelection])

    // A surface with its own footer keeps it, and the way back in it, while the session loads or fails.
    if (!session || 'error' in session) {
        const pane = session ? <PaneError message={session.error} /> : <PaneSkeleton button={!footer} />
        if (!footer) return pane
        return (
            <>
                {pane}
                {footer({ cta: copy.cta, footnote: copy.footnote ?? t('checkout.pay.authorize'), onClick: () => {}, loading: false, disabled: true, error: null, consent: null })}
            </>
        )
    }

    return (
        <StripeCheckoutProvider clientSecret={session.clientSecret}>
            <SubscribeForm sessionId={session.sessionId} sessionSelection={sessionSelection} selection={selection} priceArm={priceArm} trial={session.trial} copy={copy} onDone={() => onDone(session.trial)} onTrialRefused={onTrialRefused} footer={footer} />
        </StripeCheckoutProvider>
    )
}

function SubscribeForm({
    sessionId,
    sessionSelection,
    selection,
    priceArm,
    trial,
    copy,
    onDone,
    onTrialRefused,
    footer = defaultFooter,
}: {
    sessionId: string
    // The selection the session was created with: anything picked since is still to be sent.
    sessionSelection: PlanSelection
    selection: PlanSelection
    priceArm: PriceArm
    trial: boolean
    copy: PaneCopy
    onDone: () => void
    onTrialRefused: () => void
    footer?: SubscribeFooter
}) {
    const t = useTranslations('billing')
    const locale = useLocale()
    const errorText = useErrorText()
    const checkout = useCheckout()
    const [accepted, setAccepted] = useState(false)
    const [recordingTerms, setRecordingTerms] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [updating, setUpdating] = useState(false)
    const [error, setError] = useState<ReactNode>(null)
    const [syncedKey, setSyncedKey] = useState(() => JSON.stringify(sessionSelection))
    const [failedKey, setFailedKey] = useState<string | null>(null)
    const inFlight = useRef<string | null>(null)
    const key = JSON.stringify(selection)
    const stale = syncedKey !== key

    // The interval toggle moves the session's line items; Stripe recomputes the totals and
    // `runServerUpdate` reloads them. A selection counts as synced only once Stripe has it: until then
    // the pay button stays off, so what is confirmed is always what is shown. `runServerUpdate`
    // hands back a new `checkout` mid-flight, which re-runs this effect: the in-flight guard keeps it
    // from sending the same selection twice, and `updating` in the deps lets a selection moved
    // during the flight go out once it lands. A failed selection waits for a retry or a new one.
    useEffect(() => {
        if (trial || checkout.type !== 'success' || !stale || failedKey === key || inFlight.current) return
        const timer = setTimeout(async () => {
            inFlight.current = key
            setUpdating(true)
            const result = await checkout.checkout.runServerUpdate(async () => {
                const update = await updatePlanCheckoutAction(sessionId, JSON.parse(key) as PlanSelection)
                if (!update.ok) throw new Error(errorText(update))
            })
            inFlight.current = null
            setUpdating(false)
            if (result.type === 'error') {
                setFailedKey(key)
                setError(
                    <>
                        {result.error.message}{' '}
                        <button type="button" onClick={() => setFailedKey(null)} className="text-foreground underline underline-offset-4">
                            {t('checkout.pay.tryAgain')}
                        </button>
                    </>,
                )
            } else {
                setSyncedKey(key)
                setError(null)
            }
        }, SELECTION_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [key, stale, failedKey, updating, trial, checkout, sessionId, t])

    const loaded = checkout.type === 'success' ? checkout.checkout : null
    const interval = selection.interval
    const referrer = usePendingReferrer(trial)
    const [trialEnds] = useState(() => trialEndDate(new Date()))
    const amount = trial ? usd(0) : <UsdFlow cents={loaded?.total.total.minorUnitsAmount ?? planPriceCents(selection.quantities, interval, priceArm)} />
    // The price after the trial follows a promotion code; without one it stays the list price.
    const nextInvoice = loaded?.discountAmounts?.length ? loaded.recurring?.dueNext : null
    const afterTrialCents = nextInvoice ? Math.max(0, nextInvoice.subtotal.minorUnitsAmount - nextInvoice.discount.minorUnitsAmount) : planPriceCents(selection.quantities, 'monthly', priceArm)

    // Recorded when the box is ticked, never on the pay click: Safari only opens the Apple Pay sheet
    // inside the tap itself, so nothing may be awaited between that tap and `confirm`.
    const acceptTerms = async (checked: boolean) => {
        setAccepted(checked)
        if (!checked) return
        setRecordingTerms(true)
        setError(null)
        const terms = await acceptPlanTermsAction(sessionId)
        setRecordingTerms(false)
        if (terms.ok) return
        setAccepted(false)
        setError(errorText(terms))
    }

    const pay = async (expressCheckoutConfirmEvent?: StripeExpressCheckoutElementConfirmEvent) => {
        if (!loaded || submitting) return
        setSubmitting(true)
        setError(null)
        try {
            const result = await loaded.confirm({ redirect: 'if_required', expressCheckoutConfirmEvent })
            if (result.type === 'error') throw new Error(result.error.message)

            const outcome = await awaitOutcome(sessionId)
            if (outcome === 'trial_refused') {
                toast.error(t('checkout.pay.trialRefused'), { description: t('checkout.pay.trialRefusedDescription') })
                onTrialRefused()
                return
            }
            onDone()
        } catch (err) {
            setError(errorMessage(err, t('checkout.pay.genericError')))
        } finally {
            setSubmitting(false)
        }
    }

    const blockedReason = !accepted ? t('checkout.pay.acceptTerms') : failedKey === key ? t('checkout.pay.updateFailed') : stale ? t('checkout.pay.stillUpdating') : undefined
    const walletBlocked = !loaded || submitting || updating || stale || !accepted || recordingTerms

    return (
        <>
            <PayHeader title={trial ? t('checkout.pay.freeFor', { days: TRIAL_DAYS }) : t('checkout.pay.subscribe')} amount={amount} unit={trial ? t('checkout.pay.dueToday') : interval === 'yearly' ? t('checkout.pay.perYear') : t('checkout.pay.perMonth')} />
            {trial &&
                (referrer ? (
                    <div className="mt-4">
                        <SummaryRows
                            rows={[
                                { label: t('checkout.referral.trial'), value: t('checkout.referral.trialValue', { days: TRIAL_DAYS }) },
                                { label: t('checkout.trial.firstCharge'), value: t.rich('checkout.trial.firstChargeValue', { charge: () => <UsdFlow cents={afterTrialCents} />, date: shortDate(trialEnds, locale) }) },
                                { label: referrer.firstName ? t('checkout.referral.invitedBy', { name: referrer.firstName }) : t('checkout.referral.invitedByFriend'), value: t('checkout.referral.secondMonthFree'), strong: true },
                            ]}
                        />
                    </div>
                ) : (
                    <p className="mt-2 text-sm text-muted-foreground">{t.rich('checkout.pay.thenPerMonth', { amount: () => <UsdFlow cents={afterTrialCents} /> })}</p>
                ))}
            <div className="mt-4 flex flex-col">
                <StripePromoCode disabled={submitting || updating} />
            </div>
            <div className="mt-4">
                <StripePaymentFields wallet={{ onConfirm: event => void pay(event), disabledReason: walletBlocked ? (blockedReason ?? t('checkout.pay.pleaseWait')) : undefined }} />
            </div>
            {footer({
                cta: copy.cta,
                footnote: copy.footnote ?? t('checkout.pay.authorize'),
                onClick: () => void pay(),
                loading: submitting,
                disabled: walletBlocked || !loaded?.canConfirm,
                disabledReason: blockedReason,
                error,
                consent: <TermsConsent checked={accepted} onChange={checked => void acceptTerms(checked)} />,
            })}
        </>
    )
}

// The webhook writes the entitlement, so a confirmed payment is followed by a read until it lands.
// Past the timeout the payment went through all the same: the board catches up through realtime.
async function awaitOutcome(sessionId: string): Promise<'entitled' | 'trial_refused' | 'pending'> {
    const deadline = Date.now() + OUTCOME_TIMEOUT_MS
    while (Date.now() < deadline) {
        const result = await readCheckoutOutcomeAction(sessionId)
        if (result.ok && result.outcome.state !== 'pending') return result.outcome.state
        await new Promise(resolve => setTimeout(resolve, OUTCOME_POLL_MS))
    }
    return 'pending'
}

export function PaneSkeleton({ button = true }: { button?: boolean }) {
    return (
        <div className="flex flex-1 flex-col">
            <div className="flex items-center gap-4">
                <Skeleton className="size-10 rounded-xl" />
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-3.5 w-36" />
                    <Skeleton className="h-7 w-28" />
                </div>
            </div>
            <div className="mt-6">
                <StripePaymentFieldsSkeleton />
            </div>
            {button && <Skeleton className="mt-auto h-11 w-full" />}
        </div>
    )
}

export function PaneError({ message }: { message: string }) {
    const t = useTranslations('billing')
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium">{t('checkout.paneError')}</p>
            <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
        </div>
    )
}
