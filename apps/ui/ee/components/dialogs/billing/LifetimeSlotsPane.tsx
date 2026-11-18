'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { addAppSlotAction, removeAppSlotAction } from '@/app/api/_actions/apps.actions'
import type { LifetimeBillingState } from '@/ee/services/lifetime-addons.service'
import { useErrorText } from '@/hooks/useErrorText'
import { PLAN_PRICES_CENTS } from '@/ee/lib/billing/plans'
import { appInfo } from '@/lib/apps/catalog'
import { APP_ADDON_KEYS, APP_SLUGS } from '@/lib/apps/types'
import { randomUuid } from '@/lib/random-uuid'

import { appSlotsOf, type AppSlots } from './AppsSection'
import { shortDate } from './checkout-copy'
import { BilledFlow, CountFlow, PayFooter, RightTitle, SummaryRows, TermsConsent, usd } from './parts'

export type SlotsApplied = { title: string; body: string }

function monthlyBillCents(slots: AppSlots): number {
    return APP_SLUGS.reduce((sum, slug) => sum + slots[slug] * PLAN_PRICES_CENTS.monthly[APP_ADDON_KEYS[slug]], 0)
}

// What changing the app slots of a lifetime workspace does, before anything is applied. The slots are
// billed monthly on a subscription of their own: the first one goes through Stripe's Checkout page,
// the next ones are billed on it today, and a slot given back leaves at the renewal.
export function LifetimeSlotsPane({
    state,
    slots,
    onReset,
    onApplied,
    onFailed,
}: {
    state: LifetimeBillingState
    slots: AppSlots
    onReset: () => void
    onApplied: (applied: SlotsApplied) => void
    onFailed: () => void
}) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const errorText = useErrorText()
    const [accepted, setAccepted] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const current = appSlotsOf(state.quantities)
    const changed = APP_SLUGS.filter(slug => slots[slug] !== current[slug])
    const adding = changed.some(slug => slots[slug] > current[slug])
    const checkout = state.slotsCheckout
    const chargesToday = adding && !checkout && !state.trialing
    const renewal = state.periodEnd ? shortDate(state.periodEnd, locale) : t('plan.yourRenewal')
    const perMonth = t('apps.unit.monthly')

    const fail = (message: string) => {
        setSubmitting(false)
        setError(message)
        onFailed()
    }

    const apply = async () => {
        setSubmitting(true)
        setError(null)
        for (const slug of changed) {
            for (let removed = 0; removed < current[slug] - slots[slug]; removed += 1) {
                const result = await removeAppSlotAction(slug)
                if (!result.ok) return fail(errorText(result))
            }
        }
        for (const slug of changed) {
            for (let added = 0; added < slots[slug] - current[slug]; added += 1) {
                const result = await addAppSlotAction(slug, randomUuid())
                if (!result.ok) return fail(errorText(result))
                if (result.value.checkoutUrl) return window.location.assign(result.value.checkoutUrl)
            }
        }
        setSubmitting(false)
        onApplied(adding ? { title: t('lifetime.slots.addedTitle'), body: t('lifetime.slots.addedBody') } : { title: t('plan.change.changeScheduledTitle'), body: t('lifetime.slots.scheduledBody', { date: renewal }) })
    }

    const title =
        changed.length === 1
            ? t.rich('plan.change.changeToSlots', { count: slots[changed[0]], provider: appInfo(changed[0]).providerLabel, n: () => <CountFlow value={slots[changed[0]]} /> })
            : t('plan.change.changeAppSlots')

    const newBill = <BilledFlow cents={monthlyBillCents(slots)} interval="monthly" />
    const rows = checkout
        ? changed.map(slug => {
              const price = `${usd(PLAN_PRICES_CENTS.monthly[APP_ADDON_KEYS[slug]])}${perMonth}`
              return {
                  label: t('lifetime.slots.slotLine', { count: 1, provider: appInfo(slug).providerLabel }),
                  value: checkout.trialDays > 0 ? t('lifetime.slots.freeThen', { days: checkout.trialDays, price }) : price,
                  strong: true,
              }
          })
        : adding
          ? [{ label: t('lifetime.slots.monthlyBill'), value: newBill, strong: true }]
          : [
                { label: t('plan.change.until', { date: renewal }), value: <BilledFlow cents={monthlyBillCents(current)} interval="monthly" /> },
                { label: t('plan.change.from', { date: renewal }), value: newBill, strong: true },
            ]

    const cta = checkout ? t('lifetime.slots.continueToPayment') : chargesToday ? t('plan.change.confirmAndPay') : adding ? t('lifetime.slots.confirm') : t('plan.change.scheduleFor', { date: renewal })
    const footnote = checkout
        ? t('plan.credit.checkoutFootnote')
        : chargesToday
          ? t('lifetime.slots.billedToday')
          : adding
            ? t('lifetime.slots.freeDuringTrial')
            : t('plan.change.nothingToday')

    return (
        <>
            <RightTitle onBack={onReset} backLabel={t('plan.change.keepMyPlan')}>
                {title}
            </RightTitle>
            <div className="mt-6">
                <SummaryRows rows={rows} />
            </div>
            <PayFooter cta={cta} footnote={footnote} onClick={() => void apply()} loading={submitting} disabled={chargesToday && !accepted} disabledReason={t('plan.acceptTerms')} error={error}>
                {chargesToday && <TermsConsent checked={accepted} onChange={setAccepted} />}
            </PayFooter>
        </>
    )
}
