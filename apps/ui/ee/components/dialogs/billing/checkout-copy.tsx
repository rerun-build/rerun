import type { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import type { BadgeTone } from '@rerun/ui/primitives'

import type { CheckoutVariant } from '@/ee/lib/billing/checkout-variant'
import { longDate, shortDate } from '@/ee/lib/billing/dates'
import { BASE_PLAN_CREDITS, TRIAL_ACTIVE_AGENTS, TRIAL_CREDITS, TRIAL_DAYS, type BillingInterval } from '@/ee/lib/billing/plans'

import type { TimelineStep } from './parts'

export { longDate, shortDate }

export type BillingTranslator = ReturnType<typeof useTranslations<'billing'>>

export function nextInvoiceDate(interval: BillingInterval, from = new Date()): Date {
    const next = new Date(from)
    if (interval === 'yearly') next.setFullYear(next.getFullYear() + 1)
    else next.setMonth(next.getMonth() + 1)
    return next
}

export type CheckoutContext = {
    // The price of one invoice with its period, "$29/mo" or "$276/yr", animated as the toggle moves.
    billed: ReactNode
    nextInvoice: string
    trialEnds: string | null
    trialDaysLeft: number | null
    // The day before the trial ends, when the reminder email goes out. null once that day is past.
    reminderOn: string | null
    // What the card is charged when the trial rolls into Pro.
    firstCharge: string
    trialCancelled: boolean
    keptUntil: string | null
    parked: { title: string; agentCount: number } | null
    // The coworker that stopped on its trial credit, when the paywall was opened from its chat.
    coworker: string | null
}

export type CheckoutCopy = {
    badge?: { label: string; tone: BadgeTone }
    title: string
    subtitle: string
    timeline: TimelineStep[]
    cta: string
    // The pay button once the amount due today is known, so it reads exactly what is charged.
    payCta?: (amount: string) => string
    // How a refused payment reads, for a screen where the customer must hear their trial is safe.
    refusal?: (message: string) => string
    footnote?: string
}

function cancelStep(t: BillingTranslator): TimelineStep {
    return { when: t('checkout.timeline.anytime'), title: t('checkout.timeline.cancelTitle'), detail: t('checkout.timeline.noNotice') }
}

function nextInvoiceStep(t: BillingTranslator, context: CheckoutContext): TimelineStep {
    return { when: context.nextInvoice, title: t('checkout.timeline.nextInvoice'), detail: t.rich('checkout.timeline.billedExclVat', { billed: () => context.billed }) }
}

function trialBadge(t: BillingTranslator, context: CheckoutContext): CheckoutCopy['badge'] {
    if (context.trialDaysLeft == null) return { label: t('checkout.badge.freeTrial'), tone: 'brand' }
    return { label: context.trialDaysLeft <= 0 ? t('checkout.badge.freeTrialEndsToday') : t('checkout.badge.freeTrialDaysLeft', { count: context.trialDaysLeft }), tone: 'brand' }
}

function upgradeTimeline(t: BillingTranslator, context: CheckoutContext): TimelineStep[] {
    return [{ when: t('checkout.timeline.today'), title: t('checkout.timeline.proStarts'), detail: t('checkout.timeline.unlimitedCoworkers') }, nextInvoiceStep(t, context), cancelStep(t)]
}

// Subscribing during a trial ends it on the spot and bills the whole plan today: said on the first
// step, never left for the invoice to reveal.
function endTrialTimeline(t: BillingTranslator, context: CheckoutContext): TimelineStep[] {
    return [
        { when: t('checkout.timeline.today'), title: t('checkout.timeline.trialEndsProStarts'), detail: t.rich('checkout.timeline.chargedToday', { billed: () => context.billed }) },
        nextInvoiceStep(t, context),
        cancelStep(t),
    ]
}

// A failed end of trial leaves everything as it was: Stripe holds the change until the bank says yes.
// The test reads the server's English message, which phase 3 of the language packs turns into a code.
function trialUnchanged(t: BillingTranslator) {
    return (message: string) => (/nothing was charged/i.test(message) ? t('checkout.refusal.unchanged', { message }) : t('checkout.refusal.nothingCharged', { message }))
}

function parkedLabel(t: BillingTranslator, parked: CheckoutContext['parked']): string {
    if (!parked) return t('checkout.badge.yourCoworker')
    return parked.agentCount > 1 ? t('checkout.badge.parkedMany', { title: parked.title, count: parked.agentCount }) : parked.title
}

// `trial_card_pay_now` is not a route: it is the trial screen once the user asks to pay before the end.
export type CheckoutCopyKey = CheckoutVariant | 'trial_card_pay_now'

function trialTimeline(t: BillingTranslator, trialEnds: string, context: CheckoutContext): TimelineStep[] {
    const running: TimelineStep = { when: t('checkout.timeline.today'), title: t('checkout.timeline.trialRunning'), detail: t('checkout.timeline.zeroToday') }
    if (context.trialCancelled) return [running, { when: trialEnds, title: t('checkout.timeline.trialEnds'), detail: t('checkout.timeline.nothingCharged') }]
    return [
        running,
        ...(context.reminderOn ? [{ when: context.reminderOn, title: t('checkout.timeline.reminder'), detail: t('checkout.timeline.reminderDetail') }] : []),
        { when: trialEnds, title: t('checkout.timeline.proStarts'), detail: t('checkout.timeline.firstCharge', { charge: context.firstCharge }) },
    ]
}

export function checkoutCopy(t: BillingTranslator, variant: CheckoutCopyKey, context: CheckoutContext): CheckoutCopy {
    const trialEnds = context.trialEnds ?? t('checkout.trialEndFallback')
    switch (variant) {
        case 'start_trial':
            return {
                badge: { label: t('checkout.badge.trialDays', { days: TRIAL_DAYS }), tone: 'green' },
                title: t('checkout.variants.startTrial.title'),
                subtitle: t('checkout.variants.startTrial.subtitle', { price: context.firstCharge, date: trialEnds }),
                timeline: [
                    { when: t('checkout.timeline.today'), title: t('checkout.timeline.trialStarts'), detail: t('checkout.timeline.trialStartsDetail', { agents: TRIAL_ACTIVE_AGENTS, credits: TRIAL_CREDITS }) },
                    { when: trialEnds, title: t('checkout.timeline.proStarts'), detail: t('checkout.timeline.proStartsDetail', { charge: context.firstCharge, credits: BASE_PLAN_CREDITS }) },
                    { when: t('checkout.timeline.anytime'), title: t('checkout.timeline.cancelTitle'), detail: t('checkout.timeline.reminderDayBefore') },
                ],
                cta: t('checkout.variants.startTrial.cta'),
                footnote: t('checkout.variants.startTrial.footnote', { date: trialEnds }),
            }
        case 'trial_cardless':
            return {
                badge: trialBadge(t, context),
                title: t('checkout.variants.trialCardless.title'),
                subtitle: t('checkout.variants.trialCardless.subtitle'),
                timeline: endTrialTimeline(t, context),
                cta: t('checkout.variants.trialCardless.cta'),
            }
        case 'trial_card':
            return {
                badge: trialBadge(t, context),
                title: t('checkout.variants.trialCard.title'),
                subtitle: context.trialCancelled
                    ? t('checkout.variants.trialCard.subtitleCancelled', { date: trialEnds })
                    : context.reminderOn
                      ? t('checkout.variants.trialCard.subtitleWithReminder', { date: trialEnds })
                      : t('checkout.variants.trialCard.subtitle', { date: trialEnds }),
                timeline: trialTimeline(t, trialEnds, context),
                cta: t('checkout.variants.trialCard.cta'),
            }
        case 'trial_card_pay_now':
            return {
                badge: trialBadge(t, context),
                title: t('checkout.variants.trialCardPayNow.title'),
                subtitle: t('checkout.variants.trialCardPayNow.subtitle', { agents: TRIAL_ACTIVE_AGENTS, date: trialEnds }),
                timeline: endTrialTimeline(t, context),
                cta: t('checkout.variants.trialCardPayNow.cta'),
                footnote: t('checkout.variants.trialCardPayNow.footnote', { date: trialEnds }),
            }
        case 'credit_locked':
            return {
                badge: trialBadge(t, context),
                title: context.coworker ? t('checkout.variants.creditLocked.titleCoworker') : t('checkout.variants.creditLocked.title'),
                subtitle: context.coworker
                    ? t('checkout.variants.creditLocked.subtitleCoworker', { coworker: context.coworker })
                    : t('checkout.variants.creditLocked.subtitle', { trialCredits: TRIAL_CREDITS, credits: BASE_PLAN_CREDITS }),
                timeline: endTrialTimeline(t, context),
                cta: context.coworker ? t('checkout.variants.creditLocked.ctaCoworker') : t('checkout.variants.creditLocked.cta'),
                payCta: context.coworker ? amount => t('checkout.variants.creditLocked.payCta', { amount }) : undefined,
                refusal: trialUnchanged(t),
                footnote: t('checkout.variants.creditLocked.footnote'),
            }
        case 'no_plan':
            return {
                title: t('checkout.variants.noPlan.title'),
                subtitle: t('checkout.variants.noPlan.subtitle'),
                timeline: upgradeTimeline(t, context),
                cta: t('checkout.variants.noPlan.cta'),
            }
        case 'complimentary':
            return {
                badge: { label: t('checkout.badge.complimentary'), tone: 'brand' },
                title: t('checkout.variants.complimentary.title'),
                subtitle: t('checkout.variants.complimentary.subtitle'),
                timeline: upgradeTimeline(t, context),
                cta: t('checkout.variants.complimentary.cta'),
            }
        case 'paused':
            return {
                badge: { label: context.keptUntil ? t('checkout.badge.pausedUntil', { date: context.keptUntil }) : t('checkout.badge.paused'), tone: 'orange' },
                title: t('checkout.variants.paused.title'),
                subtitle: t('checkout.variants.paused.subtitle'),
                timeline: [{ when: t('checkout.timeline.today'), title: t('checkout.timeline.restoreStarts'), detail: t('checkout.timeline.restoreDetail') }, nextInvoiceStep(t, context), cancelStep(t)],
                cta: t('checkout.variants.paused.cta'),
            }
        case 'template':
            return {
                badge: { label: parkedLabel(t, context.parked), tone: 'brand' },
                title: t('checkout.variants.template.title'),
                subtitle: t('checkout.variants.template.subtitle'),
                timeline: [
                    {
                        when: t('checkout.timeline.today'),
                        title: t('checkout.timeline.installs'),
                        detail: context.parked && context.parked.agentCount > 1 ? t('checkout.timeline.placedCount', { count: context.parked.agentCount }) : t('checkout.timeline.placedOnBoard'),
                    },
                    nextInvoiceStep(t, context),
                    cancelStep(t),
                ],
                cta: t('checkout.variants.template.cta'),
            }
    }
}
