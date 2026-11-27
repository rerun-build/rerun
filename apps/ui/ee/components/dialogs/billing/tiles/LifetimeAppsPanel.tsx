'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { addAppSlotAction, removeAppSlotAction } from '@/app/api/_actions/apps.actions'
import { PLAN_PRICES_CENTS } from '@/ee/lib/billing/plans'
import type { LifetimeBillingState } from '@/ee/services/lifetime-addons.service'
import { useErrorText } from '@/hooks/useErrorText'
import { appInfo } from '@/lib/apps/catalog'
import { APP_ADDON_KEYS, APP_SLUGS, type AppSlug } from '@/lib/apps/types'
import { randomUuid } from '@/lib/random-uuid'

import { appSlotsOf, type AppSlots } from '../AppsSection'
import { BilledFlow, PayFooter, SummaryRows, TermsConsent, usd } from '../parts'
import { AppSlotRows, type SlotLimits } from './AppsPanel'
import { billingDate, Explain, Note, Panel } from './bits'
import type { Success, TilesData } from './views'

function monthlyBillCents(slots: AppSlots): number {
    return APP_SLUGS.reduce((sum, slug) => sum + slots[slug] * PLAN_PRICES_CENTS.monthly[APP_ADDON_KEYS[slug]], 0)
}

// The app slots of a lifetime workspace, billed monthly on a subscription of their own: the first one
// goes through Stripe's Checkout page, the next ones are billed on it today, and a slot given back
// leaves at the renewal. `onFailed` reads the state again after a change that stopped midway.
export function LifetimeAppsPanel({
    state,
    data,
    onDone,
    onFailed,
}: {
    state: LifetimeBillingState
    data: Pick<TilesData, 'apps' | 'appSlots'>
    onDone: (success: Success) => void | Promise<void>
    onFailed: () => Promise<void>
}) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const tApps = useTranslations('billing.tiles.apps')
    const errorText = useErrorText()
    const current = appSlotsOf(state.quantities)
    const [slots, setSlots] = useState<AppSlots>(current)
    const [accepted, setAccepted] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const changed = data.apps.filter(slug => slots[slug] !== current[slug])
    const added = data.apps.reduce((sum, slug) => sum + Math.max(0, slots[slug] - current[slug]), 0)
    const adding = added > 0
    const checkout = state.slotsCheckout
    const chargesToday = adding && !checkout && !state.trialing
    const renewal = state.periodEnd ? billingDate(state.periodEnd, locale) : t('plan.yourRenewal')
    const perMonth = t('apps.unit.monthly')
    // Its last slot given back, the subscription still carries it until it ends: nothing is left to
    // change on it from here.
    const lockedReason = state.cancelAtPeriodEnd ? t('plan.status.ends', { date: renewal }) : undefined

    // Stripe's Checkout sells the first slot alone, and a running trial holds one slot per app.
    const limitsOf = (slug: AppSlug, inUse: number | null): SlotLimits => {
        if (lockedReason) return { min: slots[slug], max: slots[slug], lessReason: lockedReason, moreReason: lockedReason }
        const moreReason = checkout && adding ? t('lifetime.slots.oneOnCheckout') : state.trialing && slots[slug] > 0 ? t('lifetime.slots.oneDuringTrial') : undefined
        return {
            min: inUse ?? current[slug],
            max: moreReason ? slots[slug] : Number.MAX_SAFE_INTEGER,
            lessReason: inUse === null ? tApps('loading') : slots[slug] > 0 ? tApps('disconnectFirst', { app: appInfo(slug).name }) : undefined,
            moreReason,
        }
    }

    // The button stays busy until the state is read again: a click on the stale one would replay
    // the calls that already went through.
    const fail = async (message: string) => {
        setError(message)
        try {
            await onFailed()
        } finally {
            setSubmitting(false)
        }
    }

    // Slots are added before any is given back: giving back the only slot left sets the subscription
    // to end, and the slot added next would resume it with the one given back still on it.
    const apply = async () => {
        setSubmitting(true)
        setError(null)
        for (const slug of changed) {
            for (let done = 0; done < slots[slug] - current[slug]; done += 1) {
                const result = await addAppSlotAction(slug, randomUuid())
                if (!result.ok) return fail(errorText(result))
                if (result.value.checkoutUrl) return window.location.assign(result.value.checkoutUrl)
            }
        }
        for (const slug of changed) {
            for (let done = 0; done < current[slug] - slots[slug]; done += 1) {
                const result = await removeAppSlotAction(slug)
                if (!result.ok) return fail(errorText(result))
            }
        }
        try {
            await onDone(adding ? { title: t('lifetime.slots.addedTitle'), body: t('lifetime.slots.addedBody') } : { title: t('plan.change.changeScheduledTitle'), body: t('lifetime.slots.scheduledBody', { date: renewal }) })
        } finally {
            setSubmitting(false)
        }
    }

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
    const footnote = checkout ? t('plan.credit.checkoutFootnote') : chargesToday ? t('lifetime.slots.billedToday') : adding ? t('lifetime.slots.freeDuringTrial') : t('plan.change.nothingToday')

    return (
        <Panel>
            <AppSlotRows apps={data.apps} appSlots={data.appSlots} slots={slots} interval="monthly" limitsOf={limitsOf} onChange={(slug, next) => setSlots(value => ({ ...value, [slug]: next }))} />
            <Explain>{tApps('connectHint')}</Explain>
            {changed.length > 0 ? (
                <>
                    <SummaryRows rows={rows} />
                    <PayFooter cta={cta} footnote={footnote} onClick={() => void apply()} loading={submitting} disabled={chargesToday && !accepted} disabledReason={t('plan.acceptTerms')} error={error}>
                        {chargesToday && <TermsConsent checked={accepted} onChange={setAccepted} />}
                    </PayFooter>
                </>
            ) : (
                <Note>{lockedReason ?? tApps('cantRemoveUsed')}</Note>
            )}
        </Panel>
    )
}
