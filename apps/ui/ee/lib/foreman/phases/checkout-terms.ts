import { BASE_PLAN_CREDITS, PLAN_CURRENCY, TRIAL_ACTIVE_AGENTS, TRIAL_CREDITS, TRIAL_DAYS, basePriceCents, creditsLabel, formatAmount, trialEndDate } from '@rerun/contracts'

import { shortDate } from '@/ee/lib/billing/dates'

import type { ForemanState } from '@/lib/foreman/phase'

export function checkoutTerms(state: Pick<ForemanState, 'trialSpent' | 'trialNeedsCard' | 'priceArm'>, now: Date = new Date()): string {
    const price = `${formatAmount(basePriceCents(state.priceArm), PLAN_CURRENCY)} a month`
    if (state.trialSpent) return `Their free trial has already been used, so the plan is billed today: ${price} plus local tax, cancel any time from Billing in the workspace menu.`
    const endDate = shortDate(trialEndDate(now))
    const start = state.trialNeedsCard
        ? `${TRIAL_DAYS} days free, card required: the card on the offer opens a short card form, $0 is charged today, and ${price} is charged on ${endDate} unless they cancel before, from Billing in the workspace menu.`
        : `${TRIAL_DAYS} days free and no card needed: the trial starts the moment they press the offer's button, and it only turns into ${price} if they add a card before ${endDate}, from Billing in the workspace menu. Without one, their coworkers stop and nothing is charged.`
    return `${start} The trial runs ${TRIAL_ACTIVE_AGENTS} coworkers at once with ${creditsLabel(TRIAL_CREDITS)} of AI usage; the plan then runs unlimited coworkers with ${creditsLabel(BASE_PLAN_CREDITS)} of AI usage a month. Always state Rerun credit in credits (100 credits is one dollar), never in dollars.`
}
