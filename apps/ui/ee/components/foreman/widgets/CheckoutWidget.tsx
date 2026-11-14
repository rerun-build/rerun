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
    const checkoutReported = useRef(false)
    const reportCheckoutStarted = useCallback(() => {
        if (checkoutReported.current) return
        checkoutReported.current = true
        track('checkout_started', { plan: BASE_PLAN_SLUG, source: 'foreman' })
    }, [])

    const settled = output !== undefined && output !== null
    const entitled = isSubscriptionEntitled(workspace?.subscription_status)
    const offer = trialOffer(workspace)
    const cardless = offer === 'cardless'
    const priceArm = usePriceArm()
    const arrival = useForemanStore(state => state.arrival)
    const tPrice = useTranslations('templates.price')
    const locale = useLocale()

    const answered = useRef(settled)

    const openCheckout = useCallback(() => {
        reportCheckoutStarted()
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
    const shown = useMemo<CheckoutResult | null>(
        () => recorded ?? (startedWithoutCard || entitled ? { ok: true, status: 'entitled' } : null),
        [recorded, startedWithoutCard, entitled]
    )

    useEffect(() => {
        if (!shown || answered.current) return
        answered.current = true
        onDone(shown)
    }, [shown, onDone])

    if (shown) return <CheckoutOutcome result={shown} entitled={entitled} onReopen={cardless ? () => setReopened(true) : openCheckout} />

    return <TrialOfferCard offer={offer} priceArm={priceArm} submitting={submitting || (stage === 'checkout' && billingOpen)} error={trialError} onStart={cardless ? startTrial : openCheckout} subject={arrival?.coworker ?? arrival?.title} thenPay={arrival?.paid ? priceLabel(arrival.paid, tPrice, locale) : undefined} />
}
