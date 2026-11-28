'use client'

import { BASE_PLAN_CREDITS } from '@rerun/contracts'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { BrandLogo } from '@/components/brand/BrandLogo'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { cancelPendingSwitchAction } from '@/ee/actions/billing.actions'
import { runPlanChange } from '@/ee/lib/billing/plan-payment'
import { INCLUDED_MACHINE_SIZE, PLAN_PRICES_CENTS, ZERO_QUANTITIES, machinePriceCents, type BillingInterval } from '@/ee/lib/billing/plans'
import { useErrorText } from '@/hooks/useErrorText'
import { appInfo } from '@/lib/apps/catalog'
import { APP_ADDON_KEYS, APP_SLUGS } from '@/lib/apps/types'
import { CheckIcon } from '@/lib/icons'
import { useBillingStore } from '@/stores/billing.store'

import { IntervalToggle, PayFooter, SummaryRows, TermsConsent, UsdFlow, usd, type SummaryRow } from '../parts'
import { usePlanQuote } from '../usePlanQuote'
import { planBillCents, yearlySavingsCents } from './account'
import { billingDate, CardLine, Note, Panel, TILE_FRAME } from './bits'
import type { PanelProps } from './views'

const INCLUDED = ['coworkers', 'machine', 'credits', 'apps', 'api'] as const

function inAYear(locale: string): string {
    const next = new Date()
    next.setFullYear(next.getFullYear() + 1)
    return billingDate(next, locale)
}

// How the plan is billed, and the way from the trial to Pro. A switch to yearly is charged today, the
// unused part of the month taken off; a switch back to monthly waits for the end of the paid year.
export function PlanPanel({ state, data, go, onDone }: PanelProps) {
    const t = useTranslations('billing.tiles.plan')
    const tHome = useTranslations('billing.tiles.home')
    const tInvoice = useTranslations('billing.tiles.invoice')
    const tSize = useTranslations('billing.machine.sizes')
    const locale = useLocale()
    const errorText = useErrorText()
    const upgrade = useBillingStore(s => s.upgrade)
    const [interval, setBillingInterval] = useState<BillingInterval>(state.interval)
    const [accepted, setAccepted] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [keeping, setKeeping] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const trial = state.status === 'trialing'
    const lockedReason = state.status === 'past_due' ? t('locked.pastDue') : state.cancelAtPeriodEnd ? t('locked.canceling') : undefined
    const toYearly = state.interval === 'monthly' && interval === 'yearly'
    const toMonthly = state.interval === 'yearly' && interval === 'monthly'
    const paying = !lockedReason && (trial || toYearly)
    const selection = { quantities: state.quantities, interval }
    const quote = usePlanQuote(selection, paying)
    const renewal = state.periodEnd ? billingDate(state.periodEnd, locale) : t('yourRenewal')
    const trialEnds = data.trialEndsAt ? billingDate(data.trialEndsAt, locale) : renewal
    const baseCents = planBillCents({ ...state, machineSize: INCLUDED_MACHINE_SIZE }, ZERO_QUANTITIES, interval)

    const apply = async () => {
        if (submitting) return
        setSubmitting(true)
        setError(null)
        const result = await runPlanChange(selection)
        setSubmitting(false)
        if (!result.ok) return setError(errorText(result))
        if (trial) {
            upgrade?.onPaid?.()
            return onDone({ title: t('success.proTitle'), body: t('success.proBody') })
        }
        if (result.switchAt) return onDone({ title: t('success.monthlyTitle', { date: billingDate(result.switchAt, locale) }), body: t('success.monthlyBody') })
        onDone({ title: t('success.yearlyTitle'), body: t('success.yearlyBody', { date: inAYear(locale) }) })
    }

    const keepYearly = async () => {
        setKeeping(true)
        const result = await cancelPendingSwitchAction()
        setKeeping(false)
        if (!result.ok) return setError(errorText(result))
        onDone({ title: t('success.keptYearlyTitle'), body: t('success.keptYearlyBody', { date: renewal }) })
    }

    const appRows: SummaryRow[] = APP_SLUGS.flatMap(slug => {
        const count = state.quantities[APP_ADDON_KEYS[slug]]
        if (!count) return []
        return [{ label: t('appLine', { app: appInfo(slug).name, count }), value: <UsdFlow cents={count * PLAN_PRICES_CENTS[interval][APP_ADDON_KEYS[slug]]} /> }]
    })
    const packs = state.quantities.storage_pack
    const machineRows: SummaryRow[] = [
        ...(state.machineSize === INCLUDED_MACHINE_SIZE ? [] : [{ label: tInvoice('machine', { size: tSize(state.machineSize) }), value: <UsdFlow cents={machinePriceCents(state.machineSize, interval)} /> }]),
        ...(packs > 0 ? [{ label: tInvoice('storage', { count: packs }), value: <UsdFlow cents={packs * PLAN_PRICES_CENTS[interval].storage_pack} /> }] : []),
    ]
    const yearlySaving = yearlySavingsCents(state)
    const dueToday = quote === 'loading' ? <Skeleton className="inline-block h-4 w-14" /> : <UsdFlow cents={quote?.dueTodayCents ?? planBillCents(state, state.quantities, interval)} />

    return (
        <Panel>
            <TooltipDisabledReason reason={lockedReason} className="w-fit">
                <IntervalToggle value={interval} onChange={setBillingInterval} disabled={!!lockedReason} />
            </TooltipDisabledReason>
            <div className={`flex items-center gap-3 p-4 ${TILE_FRAME}`}>
                <BrandLogo size="md" />
                <div className="min-w-0 flex-1">
                    <p className="text-base font-medium">{t('name')}</p>
                    <p className="text-sm text-muted-foreground">{interval === 'yearly' ? t.rich('billedYearly', { amount: () => <UsdFlow cents={baseCents} /> }) : t('billedMonthly')}</p>
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                    {t.rich('perMonth', { amount: () => <UsdFlow cents={interval === 'yearly' ? Math.round(baseCents / 12) : baseCents} />, unit: chunks => <span className="text-sm font-normal text-muted-foreground">{chunks}</span> })}
                </p>
            </div>

            {paying ? (
                <>
                    <SummaryRows
                        rows={[
                            { label: interval === 'yearly' ? t('proYearly') : t('proMonthly'), value: <UsdFlow cents={baseCents} /> },
                            ...machineRows,
                            ...appRows,
                            ...(!trial && quote && quote !== 'loading' && quote.unusedCreditCents > 0 ? [{ label: t('unusedMonth'), value: `-${usd(quote.unusedCreditCents)}`, muted: true }] : []),
                            { label: t('dueToday'), value: dueToday, strong: true },
                        ]}
                    />
                    <CardLine card={state.card} />
                    <PayFooter
                        cta={trial ? t('startPro') : t('switchYearly')}
                        footnote={trial ? t('keepTrial', { date: trialEnds }) : t('yearStartsToday')}
                        onClick={() => void apply()}
                        loading={submitting}
                        disabled={!accepted || quote === 'loading'}
                        disabledReason={!accepted ? t('acceptTerms') : undefined}
                        error={error}
                    >
                        <TermsConsent checked={accepted} onChange={setAccepted} />
                    </PayFooter>
                </>
            ) : toMonthly && !lockedReason ? (
                <>
                    <SummaryRows
                        rows={[
                            { label: t('until', { date: renewal }), value: t('yearlyAt', { amount: usd(planBillCents(state, state.quantities, 'yearly')) }) },
                            { label: t('from', { date: renewal }), value: t('monthlyAt', { amount: usd(planBillCents(state, state.quantities, 'monthly')) }), strong: true },
                        ]}
                    />
                    <PayFooter cta={t('switchOn', { date: renewal })} footnote={t('nothingToday')} onClick={() => void apply()} loading={submitting} error={error} />
                </>
            ) : (
                <>
                    <ul className="flex flex-col gap-2.5">
                        {INCLUDED.map(item => (
                            <li key={item} className="flex items-center gap-2.5 text-sm">
                                <CheckIcon className="size-4 shrink-0 text-brand" />
                                {t(`included.${item}`, { credits: BASE_PLAN_CREDITS })}
                            </li>
                        ))}
                    </ul>
                    {lockedReason && <Note>{lockedReason}</Note>}
                    {!lockedReason && state.pendingSwitch && (
                        <div className="flex flex-col gap-3">
                            <Note>{t('pendingSwitch', { date: billingDate(state.pendingSwitch.at, locale) })}</Note>
                            <Button variant="outline" onClick={() => void keepYearly()} disabled={keeping}>
                                {t('keepYearly')}
                            </Button>
                            {error && <p className="text-sm text-destructive">{error}</p>}
                        </div>
                    )}
                    {!lockedReason && !state.pendingSwitch && state.interval === 'monthly' && yearlySaving > 0 && <Note>{t('yearlySaves', { amount: usd(yearlySaving) })}</Note>}
                    {state.cancelPhase && !state.cancelAtPeriodEnd && (
                        <Button variant="outline" className="mt-auto w-full sm:w-fit sm:self-center" onClick={() => go('cancel')}>
                            {tHome('cancelPlan')}
                        </Button>
                    )}
                </>
            )}
        </Panel>
    )
}
