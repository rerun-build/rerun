'use client'

import { BASE_PLAN_CREDITS, CREDIT_PACK_PRICE_CENTS, CREDITS_PER_PACK, MAX_CREDIT_PACKS_PER_PURCHASE, TRIAL_CREDITS, creditsFromMicros, formatCredits } from '@rerun/contracts'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { runCreditPurchase } from '@/ee/lib/billing/plan-payment'
import { useErrorText } from '@/hooks/useErrorText'
import { cn } from '@/lib/utils'
import { useSession } from '@/supabase/session/SessionProvider'

import { useCreditQuote } from '../CreditPane'
import { RerunCreditSwitch } from '../credit-usage/RerunCreditSwitch'
import { UsageChart } from '../credit-usage/UsageChart'
import type { CreditUsageState } from '../credit-usage/useCreditUsage'
import { CountFlow, PayFooter, SummaryRows, TermsConsent, UsdFlow, usd } from '../parts'
import { LOW_CREDITS } from './account'
import { billingDate, cardBrandName, CardLine, Explain, Note, Panel, Stepper, TILE_FRAME } from './bits'
import type { PanelProps } from './views'

export function creditsLeftOf(credit: CreditUsageState): { left: number; whole: number } {
    return { left: creditsFromMicros(credit.balance?.leftMicros ?? 0), whole: creditsFromMicros(credit.balance?.wholeMicros ?? 0) }
}

export function creditsPercent({ left, whole }: { left: number; whole: number }): number {
    return whole > 0 ? (left / whole) * 100 : 0
}

function lockedReasonOf(state: PanelProps['state'], t: ReturnType<typeof useTranslations<'billing.tiles.credits'>>): string | undefined {
    if (state.status === 'past_due') return t('locked.pastDue')
    if (state.cancelAtPeriodEnd) return t('locked.canceling')
    return undefined
}

// The balance, the packs that top it up, the switch that stops all spending, and the way to usage.
export function CreditsPanel({ state, data, go, onDone }: PanelProps) {
    const t = useTranslations('billing.tiles.credits')
    const locale = useLocale()
    const errorText = useErrorText()
    const { workspace } = useSession()
    const credit = data.credit
    const balance = credit.balance
    const figures = creditsLeftOf(credit)
    const [packs, setPacks] = useState(1)
    const [accepted, setAccepted] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { quote, loading, settled } = useCreditQuote(packs)
    const onCheckout = !!quote && !quote.card
    const needsConsent = settled && !onCheckout && !accepted
    const lockedReason = lockedReasonOf(state, t)
    const listCents = packs * CREDIT_PACK_PRICE_CENTS
    const card = quote?.card ?? state.card

    if (state.status === 'trialing') {
        return (
            <Panel>
                <p className="text-4xl font-semibold tracking-tight tabular-nums">
                    <CountFlow value={figures.left} />
                </p>
                <Progress value={creditsPercent(figures)} size="md" label={t('leftLabel')} />
                <Explain>{t('trialLeft', { trial: TRIAL_CREDITS, monthly: BASE_PLAN_CREDITS })}</Explain>
                <Note>{t('packsAfterTrial')}</Note>
                <PayFooter cta={t('startPro')} onClick={() => go('plan')} />
            </Panel>
        )
    }

    const buy = async () => {
        setSubmitting(true)
        setError(null)
        const result = await runCreditPurchase(packs)
        if (!result.ok) {
            setSubmitting(false)
            return setError(errorText(result))
        }
        if (result.kind === 'checkout') return window.location.assign(result.url)
        setSubmitting(false)
        const added = packs * CREDITS_PER_PACK
        onDone({
            title: t('success.title', { count: added }),
            body: t('success.body', { count: figures.left + added }),
            rows: card ? [{ label: t('success.chargedTo', { card: `${cardBrandName(card.brand)} •••• ${card.last4}` }), value: usd(quote?.dueTodayCents ?? listCents) }] : undefined,
        })
    }

    const price = loading ? <Skeleton className="inline-block h-4 w-14" /> : <UsdFlow cents={quote?.dueTodayCents ?? listCents} />

    return (
        <Panel>
            <div className="flex flex-col gap-2">
                <div className="text-4xl font-semibold tracking-tight tabular-nums">{balance ? <CountFlow value={figures.left} /> : <Skeleton className="h-10 w-28" />}</div>
                <Progress value={creditsPercent(figures)} size="md" tone={figures.left < LOW_CREDITS ? 'destructive' : 'brand'} label={t('leftLabel')} />
                <Explain>{t('ownAi')}</Explain>
            </div>
            <SummaryRows
                rows={[
                    {
                        label: credit.resetsOn ? t('thisMonthResets', { date: billingDate(credit.resetsOn, locale) }) : t('thisMonth'),
                        value: t('monthOf', { left: formatCredits(balance?.monthLeftMicros ?? 0, locale), total: formatCredits(workspace?.rerun_budget_micros ?? 0, locale) }),
                    },
                    { label: t('fromPacks'), value: formatCredits(balance?.topupLeftMicros ?? 0, locale) },
                ]}
            />
            <div className={cn('flex flex-col gap-3 p-4', TILE_FRAME)}>
                <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{t('packs')}</p>
                        <p className="text-xs text-muted-foreground">{t('packLine', { count: CREDITS_PER_PACK, price: usd(CREDIT_PACK_PRICE_CENTS) })}</p>
                    </div>
                    <Stepper value={packs} min={1} max={lockedReason ? 1 : MAX_CREDIT_PACKS_PER_PURCHASE} onChange={setPacks} lessLabel={t('lessAria')} moreLabel={t('moreAria')} moreReason={lockedReason} />
                </div>
                <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm">
                    <span className="text-muted-foreground">{t.rich('addsCredits', { count: packs * CREDITS_PER_PACK, n: () => <CountFlow value={packs * CREDITS_PER_PACK} /> })}</span>
                    <span className="text-base font-medium tabular-nums">{price}</span>
                </div>
            </div>
            <RerunCreditSwitch paused={credit.paused} />
            <button type="button" onClick={() => go('usage')} className="w-fit text-sm text-brand underline-offset-4 hover:underline">
                {t('seeUsage')}
            </button>
            {!onCheckout && <CardLine card={card} />}
            <PayFooter
                cta={onCheckout ? t('payOnStripe') : t.rich('pay', { amount: () => price })}
                footnote={onCheckout ? t('checkoutFootnote') : t('chargedOnce')}
                onClick={() => void buy()}
                loading={submitting}
                disabled={!!lockedReason || needsConsent || loading}
                disabledReason={lockedReason ?? (needsConsent ? t('acceptTerms') : undefined)}
                error={error}
            >
                {settled && !onCheckout && !lockedReason && <TermsConsent checked={accepted} onChange={setAccepted} />}
            </PayFooter>
        </Panel>
    )
}

const TOP_COWORKERS = 5

// What the period spent so far: each day, the split between the models and paid data, and who spent it.
// Every figure covers the same days, so the split adds up to the total above it.
export function UsagePanel({ data }: PanelProps) {
    const t = useTranslations('billing.tiles.usage')
    const tUsage = useTranslations('billing.usage')
    const locale = useLocale()
    const { usage, balance, trial } = data.credit

    if (!usage || !balance) {
        return (
            <Panel>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-28 w-full rounded-lg" />
                <Skeleton className="h-24 w-full rounded-xl" />
            </Panel>
        )
    }

    const totalOf = (day: { aiMicros: number; dataMicros: number }) => day.aiMicros + day.dataMicros
    const spentMicros = usage.days.reduce((sum, day) => sum + totalOf(day), 0)
    const aiMicros = usage.days.reduce((sum, day) => sum + day.aiMicros, 0)
    const dataMicros = usage.days.reduce((sum, day) => sum + day.dataMicros, 0)
    const coworkers = [...usage.byCoworker].sort((a, b) => totalOf(b) - totalOf(a)).slice(0, TOP_COWORKERS)
    const coworkersTotal = Math.max(usage.byCoworker.reduce((sum, row) => sum + totalOf(row), 0), 1)

    return (
        <Panel>
            <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">{t('lastDays', { count: usage.days.length, credits: formatCredits(spentMicros, locale) })}</p>
                <UsageChart usage={usage} balance={balance} trial={trial} mode="daily" />
            </div>
            <SummaryRows
                rows={[
                    { label: tUsage('kind.ai'), value: formatCredits(aiMicros, locale) },
                    { label: tUsage('kind.data'), value: formatCredits(dataMicros, locale) },
                ]}
            />
            <p className="text-sm font-medium">{t('byCoworker')}</p>
            {coworkers.length ? (
                <div className="flex flex-col gap-3">
                    {coworkers.map(row => {
                        const name = row.coworker?.name ?? tUsage('otherCoworker')
                        return (
                            <div key={row.coworker?.id ?? 'other'} className="flex flex-col gap-1.5">
                                <div className="flex justify-between gap-3 text-sm">
                                    <span className="truncate">{name}</span>
                                    <span className="text-muted-foreground tabular-nums">{formatCredits(totalOf(row), locale)}</span>
                                </div>
                                <Progress value={(totalOf(row) / coworkersTotal) * 100} size="sm" label={name} />
                            </div>
                        )
                    })}
                </div>
            ) : (
                <Explain>{t('empty')}</Explain>
            )}
        </Panel>
    )
}
