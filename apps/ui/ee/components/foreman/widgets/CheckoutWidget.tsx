'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { track } from '@rerun/analytics/client'
import { priceLabel } from '@rerun/contracts'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { startTrialAction } from '@/ee/actions/billing.actions'
import { Button } from '@/components/ui/button'
import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { BASE_PLAN_SLUG } from '@/ee/lib/billing/plans'
import { usePriceArm } from '@/ee/lib/billing/usePriceArm'
import { trialOffer } from '@/ee/lib/billing/checkout-variant'
import { CircleCheckIcon, ClockIcon, CreditCardIcon, XCircleIcon } from '@/lib/icons'
import { useBillingStore } from '@/stores/billing.store'
import { useForemanStore } from '@/stores/foreman.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { ForemanOutcomeRow } from '@/components/foreman/widgets/ForemanOutcomeRow'
import { TrialOfferCard } from './trial/TrialOfferCard'

// The trial, asked for inside the conversation. On the cardless arm of the trial test it starts right
// from the offer card; the card arm, and a workspace whose trial is spent, go through the billing
// dialog's card form instead, over the conversation.

export type CheckoutResult = { ok: true; status: 'entitled' } | { ok: false; reason: 'trial_refused' | 'dismissed' | 'pending'; error?: string }

type CheckoutWidgetProps = {
    output?: unknown
    onDone: (result: CheckoutResult) => void
}

type Stage = 'offer' | 'checkout'

export function CheckoutOutcome({ result, entitled, onReopen }: { result: CheckoutResult; entitled: boolean; onReopen: () => void }) {
    const t = useTranslations('foreman.checkout')
    const openBilling = useBillingStore(state => state.openBilling)

    if (result.ok) return <ForemanOutcomeRow className="mb-2" icon={CircleCheckIcon} tone="text-emerald-500" text={t('started')} />

    // Un trial refusé n'est pas un refus de l'utilisateur : il veut toujours de Rerun, il a juste
    // déjà eu son essai. Sans cette sortie, la conversation s'arrête sur un constat.
    if (result.reason === 'trial_refused') {
        return (
            <ForemanOutcomeRow
                className="mb-2"
                icon={CreditCardIcon}
                tone="text-amber-500"
                text={t('cardUsed')}
                action={
                    <Button variant="secondary" size="sm" onClick={() => openBilling(undefined, 'trial_refused')}>
                        {t('startPlan')}
                    </Button>
                }
            />
        )
    }

    if (result.reason === 'pending') return <ForemanOutcomeRow className="mb-2" icon={ClockIcon} text={t('pending')} />

    // Refuser n'est pas fermer la porte : la ligne dit ce que le refus laisse derrière lui, et le
    // bouton rouvre le formulaire sans avoir à redemander le trial au foreman.
    return (
        <ForemanOutcomeRow
            className="mb-2"
            icon={XCircleIcon}
            text={t('notStarted')}
            action={
                entitled ? undefined : (
                    <Button variant="secondary" size="sm" onClick={onReopen}>
                        {t('startTrial')}
                    </Button>
                )
            }
        />
    )
}

export function CheckoutWidget({ output, onDone }: CheckoutWidgetProps) {
    const { workspace } = useSession()
    const errorText = useErrorText()
    const openBilling = useBillingStore(state => state.openBilling)
    const billingOpen = useBillingStore(state => state.open)
    const [stage, setStage] = useState<Stage>('offer')
    const [reopened, setReopened] = useState(false)
    const [startedWithoutCard, setStartedWithoutCard] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [trialError, setTrialError] = useState<string | null>(null)
    // Once per card, and only when the card form really opens: the card arm opens it directly, and a
    // cardless trial the server turns down falls through to it.
    const checkoutReported = useRef(false)
    const reportCheckoutStarted = useCallback(() => {
        if (checkoutReported.current) return
        checkoutReported.current = true
        track('checkout_started', { plan: BASE_PLAN_SLUG, source: 'foreman' })
    }, [])

    // A checkout that already ran is read back from the transcript: its tool call is answered for
    // good, so what happens in here from now on is display only.
    const settled = output !== undefined && output !== null
    const entitled = isSubscriptionEntitled(workspace?.subscription_status)
    // Copy and route only: startCardlessTrial re-reads the workspace and the arm.
    const offer = trialOffer(workspace)
    const cardless = offer === 'cardless'
    const priceArm = usePriceArm()
    const arrival = useForemanStore(state => state.arrival)
    const tPrice = useTranslations('templates.price')
    const locale = useLocale()

    // Answering twice throws inside the AI SDK, and both the realtime row and the poll can land in
    // the same tick. Taking the trial back up after a refusal lands here too, one turn too late to
    // answer anything: the foreman reads that start from the workspace instead.
    const answered = useRef(settled)

    // The card form is the billing dialog's. The widget waits on the workspace turning entitled; a
    // dialog closed before that leaves the offer card live again.
    const openCheckout = useCallback(() => {
        reportCheckoutStarted()
        // Coming back to the trial from the refused row: the old answer stops standing for what is
        // happening now, so the widget goes live again instead of narrating a past refusal.
        setReopened(true)
        setStage('checkout')
        openBilling(undefined, 'foreman')
    }, [openBilling, reportCheckoutStarted])

    const startTrial = useCallback(async () => {
        setTrialError(null)
        setSubmitting(true)
        const trial = await startTrialAction()
        setSubmitting(false)
        if (!trial.ok) {
            setTrialError(errorText(trial))
            return
        }
        if (!trial.entitled) {
            openCheckout()
            return
        }
        setReopened(true)
        setStartedWithoutCard(true)
    }, [openCheckout, errorText])

    const recorded = settled && !reopened ? (output as CheckoutResult) : null
    // Entitlement is written by the webhook, so the workspace row is the fastest truthful signal:
    // the session already listens to it in realtime, and reading it here rather than in an effect
    // is what keeps the success row one render away from the write.
    // A trial started without a card is entitled as the action returns, before the row catches up.
    // Entitled on its own counts too: a page reloaded between the card form and this answer comes
    // back on the offer stage with the trial already on, and answering then is what starts the build.
    const shown = useMemo<CheckoutResult | null>(
        () => recorded ?? (startedWithoutCard || entitled ? { ok: true, status: 'entitled' } : null),
        [recorded, startedWithoutCard, entitled]
    )

    // The tool is answered once, wherever the outcome came from: the poll, the timeout, the refusal
    // button, or the workspace turning entitled under the widget.
    useEffect(() => {
        if (!shown || answered.current) return
        answered.current = true
        onDone(shown)
    }, [shown, onDone])

    // Back to the offer card from the refused row on the cardless arm: nothing starts until they press
    // its button.
    if (shown) return <CheckoutOutcome result={shown} entitled={entitled} onReopen={cardless ? () => setReopened(true) : openCheckout} />

    // No way to turn it down: nothing can be built without a plan. Closing the card form lands back
    // here with the button still live.
    return <TrialOfferCard offer={offer} priceArm={priceArm} submitting={submitting || (stage === 'checkout' && billingOpen)} error={trialError} onStart={cardless ? startTrial : openCheckout} subject={arrival?.coworker ?? arrival?.title} thenPay={arrival?.paid ? priceLabel(arrival.paid, tPrice, locale) : undefined} />
}
