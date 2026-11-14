'use client'

import { TRIAL_DAYS, formatAmount, isPaid, priceCtaLabel, trialLimitsCaption } from '@rerun/contracts'
import { track } from '@rerun/analytics/client'
import { useLocale, useTranslations } from 'next-intl'
import { useErrorText } from '@/hooks/useErrorText'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { startTemplateCheckoutAction } from '@rerun/cloud/marketplace.client'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { isSubscriptionEntitled, PLAN_CURRENCY, basePriceCents, trialOffer, trialOfferLine } from '@rerun/cloud/billing'
import { usePriceArm, startPlan } from '@rerun/cloud/billing.client'
import { CreditCard, LayoutGridIcon, ShoppingBagIcon, type LucideIcon } from '@/lib/icons'
import { useBoardStore } from '@/stores/board.store'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'
import type { LibraryTemplate } from './library'
import { useTemplateImportFlow } from './useTemplateImportFlow'

export type TemplateGate = 'plan' | 'purchase' | 'place' | 'installed' | 'blocked'

export type TemplateStep = { label: string; caption: string; icon: LucideIcon }

export type TemplateCta = {
    gate: TemplateGate
    label: string
    note: string | null
    steps: TemplateStep[]
    disabled: boolean
    disabledReason: string | null
    pending: boolean
    run: () => void
    secondary?: { label: string; run: () => void }
}

export function useTemplateCta(template: LibraryTemplate, onDone: () => void): TemplateCta {
    const { workspace } = useSession()
    const isAdmin = useIsAdmin()
    const { run: startImport } = useTemplateImportFlow({ onDone })
    const [pending, startTransition] = useTransition()
    const installed = useBoardStore(s => s.agents.find(agent => agent.templateId === template.id) ?? null)
    const t = useTranslations('templates.cta')
    const tPrice = useTranslations('templates.price')
    const tTrial = useTranslations('billing.trialOffer')
    const errorText = useErrorText()
    const locale = useLocale()

    const count = template.archiveAgentNames.length
    const paid = isPaid(template.pricing)
    const recurring = template.pricing.model === 'recurring'
    const price = formatAmount(template.pricing.amountCents, template.pricing.currency, locale)
    const priceArm = usePriceArm()
    const planPrice = formatAmount(basePriceCents(priceArm), PLAN_CURRENCY, locale)
    const hireLabel = priceCtaLabel(template.pricing, count, tPrice, locale)

    const placeLabel = t('place', { count })

    const offer = trialOffer(workspace)
    const trialEligible = offer !== 'paid'
    const trialTerms = trialOfferLine(priceArm, offer, tTrial, locale)

    const trialStep: TemplateStep = trialEligible
        ? { label: tTrial('startTrial', { days: TRIAL_DAYS }), caption: trialLimitsCaption(tTrial), icon: CreditCard }
        : { label: tTrial('subscribe', { price: planPrice }), caption: tTrial('billedToday'), icon: CreditCard }
    const payStep: TemplateStep = {
        label: recurring ? t('subscribe', { price }) : t('pay', { price }),
        caption: t('payCaption'),
        icon: ShoppingBagIcon,
    }
    const placeStep: TemplateStep = { label: placeLabel, caption: t('placeCaption', { count }), icon: LayoutGridIcon }

    const status = workspace?.subscription_status
    const entitled = isSubscriptionEntitled(status)

    const startTrial = () => {
        useOnboardingStore.getState().setPendingTemplate({ slug: template.slug, title: template.title, agentCount: count, needsPlacement: true })
        startTransition(() => startPlan('template_cta'))
    }

    const buy = () => {
        track('template_purchase_started', { slug: template.slug, price_kind: template.pricing.model, amount_cents: template.pricing.amountCents })
        startTransition(async () => {
            const result = await startTemplateCheckoutAction(template.slug)
            if (!result.ok) {
                if ('needsPlan' in result) startTrial()
                else toast.error(errorText(result))
                return
            }
            if (result.outcome.kind === 'checkout') window.location.href = result.outcome.url
            else startImport(template)
        })
    }

    const use = () => startImport(template)

    if (count === 0) {
        return { gate: 'blocked', label: t('useTemplate'), note: t('nothingCaptured'), steps: [], disabled: true, disabledReason: null, pending: false, run: () => {} }
    }

    if (installed && (template.access !== 'lapsed' || isAdmin)) {
        return {
            gate: 'installed',
            label: t('open', { name: installed.name }),
            note: t('alreadyOnBoard'),
            steps: [],
            disabled: false,
            disabledReason: null,
            pending: false,
            run: () => {
                useBoardStore.getState().openAgentChat(installed.id)
                onDone()
            },
            secondary: { label: t('installAgain'), run: () => startImport(template, { again: true }) },
        }
    }

    if (paid && workspace?.is_sandbox && !template.isMine && !isAdmin) {
        return { gate: 'blocked', label: hireLabel, note: null, steps: [], disabled: true, disabledReason: t('sandboxCannotBuy'), pending: false, run: () => {} }
    }

    const ownedOrGranted = template.owned || isAdmin

    if (!entitled) {
        return {
            gate: 'plan',
            label: trialEligible
                ? ownedOrGranted
                    ? t('trialInstall')
                    : recurring
                      ? t('trialThenSubscribe', { price })
                      : t('trialThenPay', { price })
                : ownedOrGranted
                  ? t('planInstall', { plan: planPrice })
                  : recurring
                    ? t('planThenSubscribe', { plan: planPrice, price })
                    : t('planThenPay', { plan: planPrice, price }),
            note: trialEligible
                ? ownedOrGranted
                    ? trialTerms
                    : t('trialBilledSeparately', { terms: trialTerms })
                : ownedOrGranted
                  ? tTrial('trialUsed')
                  : t('trialUsedBilledSeparately'),
            steps: ownedOrGranted ? [trialStep, placeStep] : [trialStep, payStep, placeStep],
            disabled: false,
            disabledReason: null,
            pending,
            run: startTrial,
        }
    }

    if (template.access === 'lapsed' && !isAdmin) {
        return {
            gate: 'purchase',
            label: t('resubscribe', { price }),
            note: t('lapsed'),
            steps: [payStep, placeStep],
            disabled: false,
            disabledReason: null,
            pending,
            run: buy,
        }
    }

    if (!ownedOrGranted) {
        return {
            gate: 'purchase',
            label: hireLabel,
            note: workspace?.name ? t('billedTo', { workspace: workspace.name }) : null,
            steps: [payStep, placeStep],
            disabled: false,
            disabledReason: null,
            pending,
            run: buy,
        }
    }

    return {
        gate: 'place',
        label: placeLabel,
        note: template.isMine ? t('yours') : paid && template.access === 'active' ? tPrice('purchased') : null,
        steps: [],
        disabled: false,
        disabledReason: null,
        pending,
        run: use,
    }
}
