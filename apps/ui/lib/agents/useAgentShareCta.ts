'use client'

import type { AgentSharePreview } from '@rerun/contracts'
import { useLocale, useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { isSubscriptionEntitled, PLAN_CURRENCY, basePriceCents, trialOffer, trialOfferLine } from '@rerun/cloud/billing'
import { usePriceArm, startPlan } from '@rerun/cloud/billing.client'
import { CreditCard, LayoutGridIcon, type LucideIcon } from '@/lib/icons'
import { TRIAL_DAYS, formatAmount, trialLimitsCaption } from '@rerun/contracts'
import { useBoardStore } from '@/stores/board.store'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'

// Adding a shared agent is two doors rather than the template's three: have a plan, place the
// agent. There is nothing to buy, so nothing sits between them. Same ladder, same parking on the
// way to Stripe, one rung shorter.
export type ShareGate = 'plan' | 'place'

export type ShareStep = { label: string; caption: string; icon: LucideIcon }

export type AgentShareCta = {
    gate: ShareGate
    label: string
    note: string | null
    steps: ShareStep[]
    pending: boolean
    run: () => void
}

export function useAgentShareCta(token: string, preview: AgentSharePreview, onDone: () => void): AgentShareCta {
    const { workspace } = useSession()
    const [pending, startTransition] = useTransition()
    const beginAgentSharePlacement = useBoardStore(s => s.beginAgentSharePlacement)

    const t = useTranslations('agent.shareCta')
    const tTrial = useTranslations('billing.trialOffer')
    const locale = useLocale()

    const priceArm = usePriceArm()
    const planPrice = formatAmount(basePriceCents(priceArm), PLAN_CURRENCY, locale)
    const offer = trialOffer(workspace)
    const trialEligible = offer !== 'paid'

    const trialStep: ShareStep = trialEligible
        ? { label: tTrial('startTrial', { days: TRIAL_DAYS }), caption: trialLimitsCaption(tTrial), icon: CreditCard }
        : { label: tTrial('subscribe', { price: planPrice }), caption: tTrial('billedToday'), icon: CreditCard }
    const placeStep: ShareStep = { label: t('placeLabel'), caption: t('placeCaption'), icon: LayoutGridIcon }

    const place = () => {
        beginAgentSharePlacement({ token, agentName: preview.agent.name })
        onDone()
    }

    // The token is parked before starting the plan: it is the only trace that survives the round
    // trip, and it is what brings the card back on the way in.
    const startTrial = () => {
        useOnboardingStore.getState().setPendingShareLink(token)
        startTransition(() => startPlan('agent_share'))
    }

    // A workspace with no Space at all is still in onboarding: the drop on the placeholder is what
    // triggers signup and the paywall, so gating here would only get in the way of that moment.
    const hasSpace = useBoardStore.getState().spaces.length > 0
    if (hasSpace && !isSubscriptionEntitled(workspace?.subscription_status)) {
        return {
            gate: 'plan',
            label: trialEligible ? t('trialAdd') : t('planAdd', { price: planPrice }),
            note: trialEligible ? trialOfferLine(priceArm, offer, tTrial, locale) : tTrial('trialUsed'),
            steps: [trialStep, placeStep],
            pending,
            run: startTrial,
        }
    }

    return { gate: 'place', label: t('add'), note: null, steps: [], pending, run: place }
}
