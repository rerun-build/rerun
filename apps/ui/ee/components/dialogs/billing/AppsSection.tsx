'use client'

import { formatDate } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { getAppsOverviewAction } from '@/app/api/_actions/apps.actions'
import type { AppsOverview } from '@/app/api/_services/apps.service'
import { AppIcon } from '@/components/apps/PaidAppViews'
import { useEnabledPaidApps } from '@/components/layout/FeatureFlagsProvider'
import { Button } from '@/components/ui/button'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { appInfo } from '@/lib/apps/catalog'
import { APP_ADDON_KEYS, APP_SLUGS, type AppSlug } from '@/lib/apps/types'
import { PLAN_PRICES_CENTS, type AddonQuantities, type BillingInterval } from '@/ee/lib/billing/plans'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRightIcon, MinusIcon, PlusIcon } from '@/lib/icons'
import { CountFlow, UsdFlow, usd } from './parts'

export type AppSlotsState = { overview: AppsOverview | null; loaded: boolean }

export type AppSlots = Record<AppSlug, number>

export function appSlotsOf(quantities: AddonQuantities): AppSlots {
    return Object.fromEntries(APP_SLUGS.map(slug => [slug, quantities[APP_ADDON_KEYS[slug]]])) as AppSlots
}

export function withAppSlots(quantities: AddonQuantities, slots: AppSlots): AddonQuantities {
    return { ...quantities, ...Object.fromEntries(APP_SLUGS.map(slug => [APP_ADDON_KEYS[slug], slots[slug]])) }
}

type BillingTranslator = ReturnType<typeof useTranslations<'billing'>>

// " + 2 LinkedIn slots + 1 WhatsApp slot", for the lines that name a whole plan.
export function appSlotsLabel(slots: AppSlots, t: BillingTranslator): string {
    return APP_SLUGS.filter(slug => slots[slug] > 0)
        .map(slug => t('apps.slotsSuffix', { count: slots[slug], provider: appInfo(slug).providerLabel }))
        .join('')
}

// The accounts behind each app's slots: a slot only goes back once nothing fills it.
export function useAppSlots(slugs: AppSlug[], skip = false): Partial<Record<AppSlug, AppSlotsState>> {
    const enabled = useEnabledPaidApps()
    const wanted = skip ? [] : slugs.filter(slug => enabled.includes(slug))
    const key = wanted.join(',')
    const [state, setState] = useState<Partial<Record<AppSlug, AppSlotsState>>>({})
    useEffect(() => {
        if (!key) return
        let active = true
        for (const slug of key.split(',') as AppSlug[]) {
            void getAppsOverviewAction(slug).then(result => {
                if (active) setState(current => ({ ...current, [slug]: { overview: result.ok ? result.value : null, loaded: true } }))
            })
        }
        return () => {
            active = false
        }
    }, [key])
    return state
}

export type AppSlotsRow = { slug: AppSlug; value: number; current: number; slotsState: AppSlotsState; onOpen?: () => void }

type AppsSectionProps = {
    rows: AppSlotsRow[]
    interval: BillingInterval
    renewal: string
    disabled?: boolean
    onChange: (slug: AppSlug, value: number) => void
}

// The paid apps of the workspace, billed on the plan but each shown as its own app: plain lines
// under the plan and the credits, so they do not read as products of their own.
export function AppsSection({ rows, interval, renewal, disabled = false, onChange }: AppsSectionProps) {
    const t = useTranslations('billing.apps')
    return (
        <section className="@container flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <h3 className="text-2xl font-semibold tracking-tight">{t('title')}</h3>
                <p className="text-sm text-muted-foreground">{t('description')}</p>
            </div>
            {rows.map(row => (
                <AppSlotsLine key={row.slug} row={row} interval={interval} renewal={renewal} disabled={disabled} onChange={value => onChange(row.slug, value)} />
            ))}
        </section>
    )
}

function AppSlotsLine({ row, interval, renewal, disabled, onChange }: { row: AppSlotsRow; interval: BillingInterval; renewal: string; disabled: boolean; onChange: (value: number) => void }) {
    const locale = useLocale()
    const t = useTranslations('billing.apps')
    const { slug, value, current, slotsState, onOpen } = row
    const { name, providerLabel } = appInfo(slug)
    const slotPrice = PLAN_PRICES_CENTS[interval][APP_ADDON_KEYS[slug]]
    const per = interval === 'yearly' ? t('unit.yearly') : t('unit.monthly')
    const inUse = slotsState.loaded ? (slotsState.overview?.slotsInUse ?? 0) : null
    const floor = inUse ?? current
    const trialEndsAt = slotsState.overview?.subscriberTrialEndsAt ?? null
    const trialSlots = trialEndsAt ? 1 : 0
    const onlyTrialSlot = !!trialEndsAt && value === 0
    const lessReason = disabled
        ? undefined
        : onlyTrialSlot
          ? t('lessReason.freeUntil', { date: trialUntil(trialEndsAt, locale) })
          : inUse === null
            ? t('lessReason.loading')
            : value <= floor
              ? t('lessReason.disconnectFirst', { app: name })
              : undefined
    const removed = current - value

    return (
        <div className="flex flex-col gap-1 rounded-xl border border-border px-4 py-3">
            <div className="flex flex-col gap-2 @md:flex-row @md:items-center @md:justify-between @md:gap-4">
                <div className="flex min-w-0 items-center gap-3">
                    <AppIcon slug={slug} size="sm" />
                    <div className="min-w-0">
                        <AppName name={name} onOpen={onOpen} />
                        <p className="text-xs text-muted-foreground tabular-nums">
                            {trialEndsAt ? (
                                <TrialSlotsCount value={value} inUse={inUse} trialEndsAt={trialEndsAt} price={`${usd(slotPrice)}${per}`} />
                            ) : (
                                t.rich(interval === 'yearly' ? 'slots.lineYearly' : 'slots.lineMonthly', { price: usd(slotPrice), slots: () => <SlotsCount value={value} inUse={inUse} /> })
                            )}
                        </p>
                    </div>
                </div>
                <div className="flex items-center justify-between gap-3 pl-11 @md:justify-end @md:pl-0">
                    <span className="text-sm tabular-nums">
                        {onlyTrialSlot ? (
                            t('free')
                        ) : (
                            <>
                                <UsdFlow cents={value * slotPrice} />
                                <span className="text-muted-foreground">{per}</span>
                            </>
                        )}
                    </span>
                    <SlotStepper label={providerLabel} value={value + trialSlots} lessReason={lessReason} disabled={disabled} onChange={next => onChange(next - trialSlots)} />
                </div>
            </div>
            <LeavingNote removed={removed} renewal={renewal} />
        </div>
    )
}

function AppName({ name, onOpen }: { name: string; onOpen?: () => void }) {
    if (!onOpen) return <p className="truncate text-sm font-medium">{name}</p>
    return (
        <button type="button" onClick={onOpen} className="group flex items-center gap-1 truncate text-sm font-medium">
            {name}
            <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>
    )
}

function SlotsCount({ value, inUse }: { value: number; inUse: number | null }) {
    const t = useTranslations('billing.apps')
    if (value === 0) return <>{t('slots.none')}</>
    const n = () => <CountFlow value={value} />
    if (inUse === null) return <>{t.rich('slots.count', { total: value, n })}</>
    return (
        <>
            {t.rich('slots.used', {
                total: value,
                n,
                used: () => (
                    <span className="font-medium text-foreground">
                        <CountFlow value={inUse} />
                    </span>
                ),
            })}
        </>
    )
}

function trialUntil(trialEndsAt: string, locale: string): string {
    return formatDate(trialEndsAt, locale, { month: 'long', day: 'numeric' })
}

// The subscriber trial's slot is not on Stripe: the stepper shows it on top of the paid ones but never
// sends it back as a quantity, and the line says apart the day it turns into a paid one.
function TrialSlotsCount({ value, inUse, trialEndsAt, price }: { value: number; inUse: number | null; trialEndsAt: string; price: string }) {
    const locale = useLocale()
    const t = useTranslations('billing.apps')
    const trial = () => t.rich('trial.free', { date: trialUntil(trialEndsAt, locale), price, b: chunks => <span className="font-medium text-foreground">{chunks}</span> })
    if (value === 0) return trial()
    const n = () => <CountFlow value={value} />
    if (inUse === null) return t.rich('trial.withPaid', { count: value, trial, n })
    return t.rich('trial.withPaidInUse', { count: value, trial, n, inUse: () => <CountFlow value={inUse} /> })
}

function SlotStepper({ label, value, lessReason, disabled, onChange }: { label: string; value: number; lessReason?: string; disabled: boolean; onChange: (value: number) => void }) {
    const t = useTranslations('billing.apps')
    return (
        <div className="flex shrink-0 items-center gap-2">
            <TooltipDisabledReason reason={lessReason}>
                <Button variant="outline" size="icon-sm" aria-label={t('lessAria', { provider: label })} disabled={disabled || !!lessReason || value === 0} onClick={() => onChange(value - 1)}>
                    <MinusIcon />
                </Button>
            </TooltipDisabledReason>
            <span className="min-w-6 text-center text-sm font-medium tabular-nums">
                <CountFlow value={value} />
            </span>
            <Button variant="outline" size="icon-sm" aria-label={t('moreAria', { provider: label })} disabled={disabled} onClick={() => onChange(value + 1)}>
                <PlusIcon />
            </Button>
        </div>
    )
}

function LeavingNote({ removed, renewal }: { removed: number; renewal: string }) {
    const t = useTranslations('billing.apps')
    return (
        <AnimatePresence mode="popLayout" initial={false}>
            {removed > 0 && (
                <motion.span
                    key={removed}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="text-xs text-destructive"
                >
                    {t('leaving', { count: removed, date: renewal })}
                </motion.span>
            )}
        </AnimatePresence>
    )
}
