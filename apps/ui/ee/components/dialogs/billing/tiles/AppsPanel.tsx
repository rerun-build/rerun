'use client'

import { formatDate } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { AppIcon } from '@/components/apps/PaidAppViews'
import { addAppSlotAction } from '@/app/api/_actions/apps.actions'
import { Skeleton } from '@/components/ui/skeleton'
import { runPlanChange } from '@/ee/lib/billing/plan-payment'
import { PLAN_PRICES_CENTS, type BillingInterval } from '@/ee/lib/billing/plans'
import { useErrorText } from '@/hooks/useErrorText'
import { appInfo } from '@/lib/apps/catalog'
import { APP_ADDON_KEYS, type AppSlug } from '@/lib/apps/types'
import { randomUuid } from '@/lib/random-uuid'
import { cn } from '@/lib/utils'

import { appSlotsOf, withAppSlots, type AppSlots } from '../AppsSection'
import { BilledFlow, PayFooter, SummaryRows, TermsConsent, UsdFlow, usd } from '../parts'
import { usePlanQuote } from '../usePlanQuote'
import { planBillCents } from './account'
import { billingDate, Explain, Note, Panel, Stepper, TILE_FRAME } from './bits'
import type { PanelProps, TilesData } from './views'

// A trial runs one slot at most, free until the trial ends. It is added on its own path: a plan change
// during the trial ends the trial and bills Pro today.
const TRIAL_MAX_SLOTS = 1

export type SlotLimits = { min: number; max: number; lessReason?: string; moreReason?: string }

// The apps one under the other, each with the slots it holds and the stepper that changes them.
// `limitsOf` says how far a stepper goes, given the accounts in use (null while they are read).
export function AppSlotRows({
    apps,
    appSlots,
    slots,
    interval,
    limitsOf,
    onChange,
}: {
    apps: AppSlug[]
    appSlots: TilesData['appSlots']
    slots: AppSlots
    interval: BillingInterval
    limitsOf: (slug: AppSlug, inUse: number | null) => SlotLimits
    onChange: (slug: AppSlug, next: number) => void
}) {
    const t = useTranslations('billing.tiles.apps')
    const locale = useLocale()
    return (
        <div className={cn('divide-y divide-border', TILE_FRAME)}>
            {apps.map(slug => {
                const slotsState = appSlots[slug]
                const inUse = slotsState?.loaded ? (slotsState.overview?.slotsInUse ?? 0) : null
                const freeUntil = slotsState?.overview?.subscriberTrialEndsAt ?? null
                const limits = limitsOf(slug, inUse)
                const { name } = appInfo(slug)
                const price = usd(PLAN_PRICES_CENTS[interval][APP_ADDON_KEYS[slug]])
                return (
                    <div key={slug} className="flex items-center gap-3 p-4">
                        <AppIcon slug={slug} size="md" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{name}</p>
                            <div className="text-xs text-muted-foreground tabular-nums">
                                {inUse === null && slots[slug] > 0 ? (
                                    <Skeleton className="inline-block h-3 w-24 align-middle" />
                                ) : slots[slug] ? (
                                    t('inUse', { used: inUse ?? 0, count: slots[slug] })
                                ) : interval === 'yearly' ? (
                                    t('noSlotYearly', { price })
                                ) : (
                                    t('noSlotMonthly', { price })
                                )}
                            </div>
                            {freeUntil && <p className="text-xs text-muted-foreground">{t('freeUntil', { date: formatDate(freeUntil, locale, { month: 'long', day: 'numeric' }) })}</p>}
                        </div>
                        <Stepper value={slots[slug]} min={limits.min} max={limits.max} onChange={next => onChange(slug, next)} lessLabel={t('lessAria', { app: name })} moreLabel={t('moreAria', { app: name })} lessReason={limits.lessReason} moreReason={limits.moreReason} />
                    </div>
                )
            })}
        </div>
    )
}

// One slot per account the coworkers use. Adding one is charged today for what is left of the period,
// removing one takes effect at the renewal, and a slot an account fills cannot be removed.
export function AppsPanel({ state, data, onDone }: PanelProps) {
    const t = useTranslations('billing.tiles.apps')
    const locale = useLocale()
    const errorText = useErrorText()
    const current = appSlotsOf(state.quantities)
    const [slots, setSlots] = useState<AppSlots>(current)
    const [accepted, setAccepted] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const trial = state.status === 'trialing'
    const lockedReason = state.status === 'past_due' ? t('locked.pastDue') : state.cancelAtPeriodEnd ? t('locked.canceling') : undefined
    const interval = state.interval
    const renewal = state.periodEnd ? billingDate(state.periodEnd, locale) : t('yourRenewal')
    const added = data.apps.reduce((sum, slug) => sum + Math.max(0, slots[slug] - current[slug]), 0)
    const removed = data.apps.reduce((sum, slug) => sum + Math.max(0, current[slug] - slots[slug]), 0)
    const selection = { quantities: withAppSlots(state.quantities, slots), interval }
    const quote = usePlanQuote(selection, added > 0 && !trial)
    const changed = data.apps.filter(slug => slots[slug] !== current[slug])
    const slotPrice = (slug: AppSlug) => PLAN_PRICES_CENTS[interval][APP_ADDON_KEYS[slug]]
    const dueTodayCents = trial ? 0 : quote && quote !== 'loading' ? quote.dueTodayCents : null

    const limitsOf = (slug: AppSlug, inUse: number | null): SlotLimits => ({
        min: lockedReason ? slots[slug] : trial ? current[slug] : (inUse ?? current[slug]),
        max: lockedReason ? slots[slug] : trial ? TRIAL_MAX_SLOTS : Number.MAX_SAFE_INTEGER,
        lessReason: lockedReason ?? (trial && slots[slug] > 0 ? t('trialKeepsSlot') : inUse === null ? t('loading') : slots[slug] > 0 ? t('disconnectFirst', { app: appInfo(slug).name }) : undefined),
        moreReason: lockedReason ?? (trial ? t('trialOneSlot') : undefined),
    })

    const apply = async () => {
        setSubmitting(true)
        setError(null)
        if (trial) {
            for (const slug of changed) {
                const result = await addAppSlotAction(slug, randomUuid())
                if (!result.ok) {
                    setSubmitting(false)
                    return setError(errorText(result))
                }
            }
            setSubmitting(false)
            return onDone({ title: t('success.title'), body: t('success.addedBody') })
        }
        const result = await runPlanChange(selection)
        setSubmitting(false)
        if (!result.ok) return setError(errorText(result))
        onDone(added ? { title: t('success.title'), body: t('success.addedBody') } : { title: t('success.title'), body: t('success.removedBody', { date: renewal }) })
    }

    return (
        <Panel>
            <AppSlotRows apps={data.apps} appSlots={data.appSlots} slots={slots} interval={interval} limitsOf={limitsOf} onChange={(slug, next) => setSlots(value => ({ ...value, [slug]: next }))} />
            <Explain>{t('connectHint')}</Explain>
            {changed.length > 0 ? (
                <>
                    <SummaryRows
                        rows={[
                            ...changed.map(slug => {
                                const delta = slots[slug] - current[slug]
                                const cents = Math.abs(delta) * slotPrice(slug)
                                return {
                                    label: delta > 0 ? t('addedLine', { app: appInfo(slug).name, count: delta }) : t('removedLine', { app: appInfo(slug).name, count: -delta }),
                                    value: (
                                        <>
                                            {delta > 0 ? '+' : '-'}
                                            <BilledFlow cents={cents} interval={interval} />
                                        </>
                                    ),
                                }
                            }),
                            { label: t('newTotal'), value: <BilledFlow cents={planBillCents(state, selection.quantities, interval)} interval={interval} /> },
                            ...(added
                                ? [
                                      {
                                          label: trial ? t('dueTodayTrial') : t('dueToday'),
                                          value: dueTodayCents === null ? <Skeleton className="inline-block h-4 w-14" /> : <UsdFlow cents={dueTodayCents} />,
                                          strong: true,
                                      },
                                  ]
                                : []),
                        ]}
                    />
                    {removed > 0 && <Note>{t('removedNote', { date: renewal })}</Note>}
                    <PayFooter
                        cta={added ? t.rich('addAndPay', { count: added, amount: () => (dueTodayCents === null ? <Skeleton className="inline-block h-4 w-10 align-middle" /> : <UsdFlow cents={dueTodayCents} />) }) : t('save')}
                        onClick={() => void apply()}
                        loading={submitting}
                        disabled={added > 0 && (!accepted || dueTodayCents === null)}
                        disabledReason={added > 0 && !accepted ? t('acceptTerms') : undefined}
                        error={error}
                    >
                        {added > 0 && <TermsConsent checked={accepted} onChange={setAccepted} />}
                    </PayFooter>
                </>
            ) : (
                <Note>{lockedReason ?? (trial && data.apps.some(slug => current[slug] > 0) ? t('trialKeepsSlot') : t('cantRemoveUsed'))}</Note>
            )}
        </Panel>
    )
}
