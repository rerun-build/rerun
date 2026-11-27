'use client'

import { creditsFromMicros, type MachineReading } from '@rerun/contracts'
import { formatNumber } from '@rerun/i18n/format'
import { Badge } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useState, type ComponentType, type ReactNode } from 'react'
import { toast } from 'sonner'

import { AppIcon } from '@/components/apps/PaidAppViews'
import { BrandLogo } from '@/components/brand/BrandLogo'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { resumeSubscriptionAction } from '@/ee/actions/billing.actions'
import { MACHINE_SPECS, PLAN_PRICES_CENTS, machineDiskGib, type MachineSize } from '@/ee/lib/billing/plans'
import type { SubscriptionState } from '@/ee/services/billing.service'
import { useErrorText } from '@/hooks/useErrorText'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { appInfo } from '@/lib/apps/catalog'
import { APP_ADDON_KEYS } from '@/lib/apps/types'
import { ARCHIVE_RETENTION_DAYS } from '@/lib/archive/retention'
import { CoinsIcon, CreditCardIcon, Grid2x2Icon, ServerIcon, TriangleAlertIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useSession } from '@/supabase/session/SessionProvider'

import { CountFlow, usd } from '../parts'
import { LOW_CREDITS, planBadge, planBillCents, tilesAccountState } from './account'
import { billingDate, CardBrand, cardBrandName, cardExpiry, TILE_FRAME } from './bits'
import { creditsLeftOf, creditsPercent } from './CreditsPanels'
import { InvoiceRows } from './PaymentPanels'
import type { PanelProps, TilesData } from './views'

type Glyph = ComponentType<{ className?: string }>

const HISTORY_ROWS = 4

export function Tile({ icon, title, children, actions }: { icon: Glyph; title: string; children: ReactNode; actions?: ReactNode }) {
    return (
        <section className={cn('flex min-w-0 flex-col gap-3 p-4', TILE_FRAME)}>
            <div className="flex items-center gap-2.5 text-base text-muted-foreground">
                <Icon size="sm" icon={icon} />
                {title}
            </div>
            <div className="flex flex-1 flex-col gap-2">{children}</div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </section>
    )
}

// The size the workspace runs on this period, how full its disk is, and the way to another size.
// `pending` is the smaller size it goes to at its renewal, `action` a second button beside the first.
export function MachineTile({
    held,
    machine,
    pending,
    lockedReason,
    onChange,
    action,
}: {
    held: SubscriptionState['heldMachine']
    machine: MachineReading | null
    pending: { size: MachineSize; date: string } | null
    lockedReason?: string
    onChange: () => void
    action?: ReactNode
}) {
    const t = useTranslations('billing.tiles.home.machine')
    const tSize = useTranslations('billing.machine.sizes')
    const locale = useLocale()
    const { machineSize, storagePacks } = held
    const spec = MACHINE_SPECS[machineSize]
    const diskGib = machineDiskGib(machineSize, storagePacks)
    const used = machine?.usedDiskGib ?? null

    return (
        <Tile
            icon={ServerIcon}
            title={t('title')}
            actions={
                <>
                    <TooltipDisabledReason reason={lockedReason} className="flex flex-1">
                        <Button size="sm" variant="outline" className="flex-1" disabled={!!lockedReason} onClick={onChange}>
                            {t('change')}
                        </Button>
                    </TooltipDisabledReason>
                    {action}
                </>
            }
        >
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-3xl font-semibold tracking-tight">{tSize(machineSize)}</p>
                {pending && (
                    <Badge size="sm" tone="yellow">
                        {t('from', { size: tSize(pending.size), date: pending.date })}
                    </Badge>
                )}
            </div>
            <Progress value={used === null ? 0 : Math.min(100, (used / diskGib) * 100)} size="sm" tone={used !== null && used / diskGib > 0.9 ? 'destructive' : 'brand'} label={t('diskLabel')} />
            <p className="text-xs text-muted-foreground tabular-nums">
                {used === null
                    ? t('specs', { disk: diskGib, memory: spec.memoryGib, vcpus: spec.vcpus })
                    : t('specsUsed', { used: formatNumber(Math.ceil(used), locale), disk: diskGib, memory: spec.memoryGib, vcpus: spec.vcpus })}
            </p>
        </Tile>
    )
}

// A trial keeps the included machine: Pro comes first.
function PlanMachineTile({ state, go }: Pick<PanelProps, 'state' | 'go'>) {
    const t = useTranslations('billing.tiles.home.machine')
    const locale = useLocale()
    const trial = state.status === 'trialing'
    const pending = state.pendingDowngrade.machine_size
    return (
        <MachineTile
            held={state.heldMachine}
            machine={state.machine}
            pending={pending ? { size: pending, date: state.periodEnd ? billingDate(state.periodEnd, locale) : '' } : null}
            lockedReason={trial ? t('trialReason') : state.status === 'past_due' ? t('locked.pastDue') : state.cancelAtPeriodEnd ? t('locked.canceling') : undefined}
            onChange={() => go('machine')}
            action={
                trial && (
                    <Button size="sm" onClick={() => go('plan')}>
                        {t('startPro')}
                    </Button>
                )
            }
        />
    )
}

function StateNotice({ state, data, go, onDone }: Pick<PanelProps, 'state' | 'data' | 'go' | 'onDone'>) {
    const t = useTranslations('billing.tiles.home.notice')
    const tPlan = useTranslations('billing.plan')
    const locale = useLocale()
    const errorText = useErrorText()
    const { access } = useWorkspaceAccess()
    const [resuming, setResuming] = useState(false)
    const kind = tilesAccountState(state, data.credit.balance?.leftMicros ?? null)
    const ends = state.periodEnd ? billingDate(state.periodEnd, locale) : tPlan('cancelPending.endOfPeriod')
    const trial = state.status === 'trialing'

    const resume = async () => {
        setResuming(true)
        const result = await resumeSubscriptionAction()
        setResuming(false)
        if (!result.ok) return toast.error(tPlan('cancelPending.resumeFailed'), { description: errorText(result) })
        onDone(trial ? { title: t('trialResumedTitle'), body: t('trialResumedBody', { date: ends }) } : { title: tPlan('success.backOnTitle'), body: tPlan('success.backOnBody', { date: ends }) })
    }

    const notice = (() => {
        if (kind === 'past_due') {
            const invoice = state.openInvoice
            return {
                danger: true,
                title: invoice ? tPlan('pastDue.declinedOn', { amount: usd(invoice.amountCents), date: billingDate(invoice.createdAt, locale) }) : tPlan('pastDue.lastDeclined'),
                body: access === 'paused' ? tPlan('pastDue.paused') : tPlan('pastDue.keepRunning'),
                action: (
                    <Button size="sm" onClick={() => go('card')}>
                        {tPlan('pastDue.cta')}
                    </Button>
                ),
            }
        }
        if (kind === 'low') {
            return {
                danger: true,
                title: t('lowTitle', { count: creditsLeftOf(data.credit).left }),
                body: t('lowBody'),
                action: (
                    <Button size="sm" onClick={() => go('credits')}>
                        {t('addCredits')}
                    </Button>
                ),
            }
        }
        if (kind === 'canceling') {
            return {
                danger: false,
                title: trial ? t('trialEndsTitle', { date: ends }) : t('endsTitle', { date: ends }),
                body: t('endsBody', { days: ARCHIVE_RETENTION_DAYS }),
                action: (
                    <Button size="sm" variant="outline" disabled={resuming} onClick={() => void resume()}>
                        {trial ? t('resumeTrial') : t('resumePro')}
                    </Button>
                ),
            }
        }
        if (kind === 'trial') {
            const amount = usd(state.nextInvoice?.amountCents ?? planBillCents(state, state.quantities, state.interval))
            const date = data.trialEndsAt ? billingDate(data.trialEndsAt, locale) : ends
            return { danger: false, title: t('trialTitle', { amount, date }), body: t('trialBody'), action: null }
        }
        return null
    })()

    if (!notice) return null
    return (
        <Alert variant={notice.danger ? 'danger' : 'brand'} stripes className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3">
            <TriangleAlertIcon className="size-4 shrink-0" />
            <div className="min-w-0 flex-1 basis-48">
                <AlertTitle>{notice.title}</AlertTitle>
                <AlertDescription>{notice.body}</AlertDescription>
            </div>
            {notice.action}
        </Alert>
    )
}

function PlanCard({ state, data, go }: Pick<PanelProps, 'state' | 'data' | 'go'>) {
    const t = useTranslations('billing.tiles.home.plan')
    const locale = useLocale()
    const badge = planBadge(state)
    const trial = state.status === 'trialing'
    const date = state.periodEnd ? billingDate(state.periodEnd, locale) : ''
    const amount = usd(planBillCents(state, state.quantities, state.interval))
    const badgeLabel =
        badge.kind === 'ends'
            ? t('badge.ends', { date })
            : badge.kind === 'monthlyFrom'
              ? t('badge.monthlyFrom', { date: state.pendingSwitch ? billingDate(state.pendingSwitch.at, locale) : date })
              : t(`badge.${badge.kind}`)
    const line = trial
        ? t('trialLine', { date: data.trialEndsAt ? billingDate(data.trialEndsAt, locale) : date, amount })
        : t(state.interval === 'yearly' ? (state.cancelAtPeriodEnd ? 'yearlyEnds' : 'yearlyRenews') : state.cancelAtPeriodEnd ? 'monthlyEnds' : 'monthlyRenews', { amount, date })

    return (
        <div className={cn('flex flex-wrap items-center gap-3 p-4', TILE_FRAME)}>
            <BrandLogo size="md" />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{t('name')}</p>
                    <Badge size="sm" tone={badge.tone}>
                        {badgeLabel}
                    </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{line}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => go('plan')}>
                {trial ? t('startPro') : t('manage')}
            </Button>
        </div>
    )
}

// A workspace with no monthly credit (a lifetime deal) only holds what it bought.
export function CreditsTile({ state, data, go }: { state: Pick<SubscriptionState, 'status' | 'cancelAtPeriodEnd'>; data: Pick<TilesData, 'credit'>; go: (view: 'credits' | 'usage') => void }) {
    const t = useTranslations('billing.tiles.home.credits')
    const tCredits = useTranslations('billing.tiles.credits')
    const locale = useLocale()
    const { workspace } = useSession()
    const credit = data.credit
    const figures = creditsLeftOf(credit)
    const trial = state.status === 'trialing'
    const lockedReason = state.status === 'past_due' ? t('locked.pastDue') : state.cancelAtPeriodEnd ? t('locked.canceling') : undefined
    const balance = credit.balance
    const monthCredits = creditsFromMicros(balance?.monthLeftMicros ?? 0)
    const packCredits = creditsFromMicros(balance?.topupLeftMicros ?? 0)
    const monthlyMicros = workspace?.rerun_budget_micros ?? 0
    const monthTotal = formatNumber(creditsFromMicros(monthlyMicros), locale)

    return (
        <Tile
            icon={CoinsIcon}
            title={t('title')}
            actions={
                trial ? (
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => go('credits')}>
                        {t('details')}
                    </Button>
                ) : (
                    <>
                        <TooltipDisabledReason reason={lockedReason} className="flex flex-1">
                            <Button size="sm" className="flex-1" disabled={!!lockedReason} onClick={() => go('credits')}>
                                {t('add')}
                            </Button>
                        </TooltipDisabledReason>
                        <Button size="sm" variant="ghost" onClick={() => go('usage')}>
                            {t('seeUsage')}
                        </Button>
                    </>
                )
            }
        >
            <div className="text-3xl font-semibold tracking-tight tabular-nums">{balance ? <CountFlow value={figures.left} /> : <Skeleton className="h-9 w-24" />}</div>
            <Progress value={creditsPercent(figures)} size="sm" tone={balance && figures.left < LOW_CREDITS ? 'destructive' : 'brand'} label={t('leftLabel')} />
            <p className="text-xs text-muted-foreground tabular-nums">
                {trial
                    ? t('trialLine')
                    : monthlyMicros === 0
                      ? tCredits('fromPacks')
                      : packCredits > 0
                      ? t('monthAndPacks', { month: formatNumber(monthCredits, locale), total: monthTotal, packs: formatNumber(packCredits, locale) })
                      : t('month', { month: formatNumber(monthCredits, locale), total: monthTotal })}
            </p>
        </Tile>
    )
}

export function AppsTile({ state, data, go }: { state: Pick<SubscriptionState, 'status' | 'quantities' | 'interval'>; data: Pick<TilesData, 'apps'>; go: (view: 'apps') => void }) {
    const t = useTranslations('billing.tiles.home.apps')
    const trial = state.status === 'trialing'
    return (
        <Tile
            icon={Grid2x2Icon}
            title={t('title')}
            actions={
                <Button size="sm" variant="outline" className="flex-1" onClick={() => go('apps')}>
                    {t('manage')}
                </Button>
            }
        >
            {data.apps.map(slug => {
                const count = state.quantities[APP_ADDON_KEYS[slug]]
                return (
                    <div key={slug} className="flex items-center gap-2.5 text-sm">
                        <AppIcon slug={slug} size="sm" />
                        <span className="min-w-0 flex-1 truncate">{appInfo(slug).name}</span>
                        <span className="text-muted-foreground tabular-nums">{count ? t('slots', { count, amount: usd(trial ? 0 : count * PLAN_PRICES_CENTS[state.interval][APP_ADDON_KEYS[slug]]) }) : t('off')}</span>
                    </div>
                )
            })}
        </Tile>
    )
}

function PaymentTile({ state, go }: Pick<PanelProps, 'state' | 'go'>) {
    const t = useTranslations('billing.tiles')
    const { card, business } = state
    return (
        <Tile
            icon={CreditCardIcon}
            title={t('home.payment.title')}
            actions={
                <Button size="sm" variant="outline" className="flex-1" onClick={() => go('payment')}>
                    {t('home.payment.update')}
                </Button>
            }
        >
            <div className="flex items-center gap-3">
                <CardBrand brand={card?.brand ?? null} />
                {card ? (
                    <div className="min-w-0">
                        <p className="truncate text-base font-medium">{t('card.number', { network: cardBrandName(card.brand), last4: card.last4 })}</p>
                        <p className="text-xs text-muted-foreground">{t('card.expires', { date: cardExpiry(card) })}</p>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">{t('card.none')}</p>
                )}
            </div>
            {business.name && <p className="truncate text-xs text-muted-foreground">{business.name}</p>}
        </Tile>
    )
}

export function Home({ state, data, go, onDone }: Pick<PanelProps, 'state' | 'data' | 'go' | 'onDone'>) {
    const t = useTranslations('billing.tiles.home')
    const trial = state.status === 'trialing'
    const monthsEarned = data.referrals.overview?.monthsEarned ?? 0
    const link = 'underline-offset-4 hover:text-foreground hover:underline'

    return (
        <div className="flex flex-col gap-4">
            <StateNotice state={state} data={data} go={go} onDone={onDone} />
            <PlanCard state={state} data={data} go={go} />

            <div className="grid gap-3 @lg:grid-cols-2">
                <CreditsTile state={state} data={data} go={go} />
                <PlanMachineTile state={state} go={go} />
                {data.apps.length > 0 && <AppsTile state={state} data={data} go={go} />}
                <PaymentTile state={state} go={go} />
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-sm font-medium">{t('history')}</p>
                <Button size="xs" variant="ghost" onClick={() => go('invoices')}>
                    {t('allInvoices')}
                </Button>
            </div>
            {data.invoices && data.invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{trial ? t('noInvoiceTrial') : t('noInvoice')}</p>
            ) : (
                <InvoiceRows invoices={data.invoices} limit={HISTORY_ROWS} />
            )}

            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 pt-1 text-xs text-muted-foreground">
                {!trial && (
                    <button type="button" onClick={() => go('referral')} className={link}>
                        {monthsEarned ? t('referEarned', { count: monthsEarned }) : t('refer')}
                    </button>
                )}
                {state.cancelPhase && !state.cancelAtPeriodEnd && (
                    <button type="button" onClick={() => go('cancel')} className={link}>
                        {trial ? t('cancelTrial') : t('cancelPlan')}
                    </button>
                )}
            </div>
        </div>
    )
}
