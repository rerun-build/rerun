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

// La porte que ce clic va franchir. `blocked` = rien à franchir, la template n'est pas installable.
// `installed` = ses coworkers sont déjà sur le board : le clic les ouvre au lieu d'en poser d'autres.
export type TemplateGate = 'plan' | 'purchase' | 'place' | 'installed' | 'blocked'

export type TemplateStep = { label: string; caption: string; icon: LucideIcon }

export type TemplateCta = {
    gate: TemplateGate
    label: string
    note: string | null
    // Ce que l'utilisateur va traverser, dans l'ordre, avant que ses agents soient sur le board.
    // Vide quand un seul clic suffit : il n'y a rien à annoncer.
    steps: TemplateStep[]
    disabled: boolean
    // Rendered as the button's title, so a disabled button still explains itself on hover.
    disabledReason: string | null
    pending: boolean
    run: () => void
    secondary?: { label: string; run: () => void }
}

// Installer une template, c'est franchir trois portes dans cet ordre : avoir un plan, posséder la
// template, poser les agents. Chaque surface (la fiche d'un lien partagé, le panneau de la library)
// pose la même question au même endroit, et chaque retour de Stripe rentre à nouveau dans l'échelle
// plutôt que dans un chemin parallèle. Le libellé du bouton dit toujours la porte suivante, et
// `steps` annonce d'avance celles qui restent derrière.
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

    // Un seul essai gratuit par workspace, avec ou sans carte selon le bras du test. Ici pour le
    // libellé seulement : le serveur tranche au clic.
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

    // Porte 1. Trial sans carte, Checkout carte ou facturation immédiate : c'est le serveur qui
    // tranche (startPlan). La template est parkée AVANT : c'est la seule trace qui survive à
    // l'aller-retour, et c'est elle que PostPaymentDialog relit au retour pour reprendre l'échelle
    // là où elle s'est arrêtée.
    const startTrial = () => {
        useOnboardingStore.getState().setPendingTemplate({ slug: template.slug, title: template.title, agentCount: count, needsPlacement: true })
        startTransition(() => startPlan('template_cta'))
    }

    // Porte 2.
    const buy = () => {
        track('template_purchase_started', { slug: template.slug, price_kind: template.pricing.model, amount_cents: template.pricing.amountCents })
        startTransition(async () => {
            const result = await startTemplateCheckoutAction(template.slug)
            if (!result.ok) {
                // Le plan manquant ne devrait plus arriver ici (la porte 1 passe avant), mais le
                // serveur reste l'autorité : s'il le dit, on repart par le trial.
                if ('needsPlan' in result) startTrial()
                else toast.error(errorText(result))
                return
            }
            // Free and already-owned come back from the server rather than being assumed here: the
            // template may have been bought from another tab.
            if (result.outcome.kind === 'checkout') window.location.href = result.outcome.url
            else startImport(template)
        })
    }

    // Porte 3.
    const use = () => startImport(template)

    if (count === 0) {
        return { gate: 'blocked', label: t('useTemplate'), note: t('nothingCaptured'), steps: [], disabled: true, disabledReason: null, pending: false, run: () => {} }
    }

    // Les coworkers déjà posés s'ouvrent d'abord : une seconde équipe aux mêmes noms, chacune à
    // installer de zéro, ne se pose que sur un « Install again » explicite. Un abonnement échu passe
    // quand même, c'est lui qui rallume les coworkers déjà là.
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

    // The sandbox has no plan and no card of its own, so it can hold a draft but never a purchase.
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
