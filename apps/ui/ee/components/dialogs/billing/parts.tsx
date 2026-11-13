'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState, type ReactNode } from 'react'

import { AMOUNT_LOCALE, amountFormat, formatAmount } from '@rerun/contracts'
import { BorderBeam } from '@rerun/ui'
import { ExpertAvatar, initialsFromName } from '@rerun/ui/experts'
import { Badge, useScrollFade, type BadgeTone } from '@rerun/ui/primitives'
import NumberFlow from '@number-flow/react'
import { AnimatePresence, motion } from 'motion/react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { BASE_PLAN_CREDITS, DEFAULT_PRICE_ARM, PLAN_CURRENCY, TRIAL_ACTIVE_AGENTS, TRIAL_CREDITS, TRIAL_DAYS, ZERO_QUANTITIES, perMonthCents, planPriceCents, yearlyDiscountPercent, type BillingInterval, type PriceArm } from '@/ee/lib/billing/plans'
import { ArrowLeft, BrainIcon, CheckIcon, CoinsIcon, CpuIcon, CreditCardIcon, Loader2Icon, Package, Repeat, TriangleAlertIcon, UserPlus, XIcon, ZapIcon, type LucideIcon } from '@/lib/icons'
import { TESTIMONIALS, testimonialCopy } from '@rerun/cloud/testimonials'
import { landingUrl } from '@/lib/site'
import { cn } from '@/lib/utils'

export function usd(cents: number): string {
    return formatAmount(cents, PLAN_CURRENCY)
}

// The animated twins of `usd` and a plain count, for every figure the slider or the toggle moves.
export function UsdFlow({ cents }: { cents: number }) {
    return <NumberFlow value={cents / 100} format={amountFormat(cents, PLAN_CURRENCY)} locales={AMOUNT_LOCALE} />
}

export function CountFlow({ value }: { value: number }) {
    return <NumberFlow value={value} locales={AMOUNT_LOCALE} />
}

export function BilledFlow({ cents, interval }: { cents: number; interval: BillingInterval }) {
    const t = useTranslations('billing.parts.interval')
    return <span className="whitespace-nowrap">{t.rich(interval === 'yearly' ? 'perYear' : 'perMonth', { amount: () => <UsdFlow cents={cents} /> })}</span>
}

export function Headline({ badge, title, subtitle }: { badge?: { label: string; tone: BadgeTone }; title: string; subtitle: string }) {
    return (
        <div className="flex flex-col items-start gap-2 sm:gap-3">
            {badge && (
                <Badge size="sm" tone={badge.tone}>
                    {badge.label}
                </Badge>
            )}
            <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
            <p className="text-sm text-muted-foreground sm:text-base">{subtitle}</p>
        </div>
    )
}

export type TimelineStep = { when: string; title: string; detail: ReactNode }

// One column per step, never narrower than a short line of detail: where the column is too narrow
// for all of them, the row scrolls sideways and the edge still hiding a step fades.
export function Timeline({ steps }: { steps: TimelineStep[] }) {
    const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
    const fadeMask = useScrollFade(scroller, { axis: 'x', fadeSize: 40 })
    const inset = `${50 / steps.length}%`
    return (
        <div ref={setScroller} className="no-scrollbar mt-5 overflow-x-auto pt-1" style={{ maskImage: fadeMask, WebkitMaskImage: fadeMask }}>
            <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, minWidth: `${steps.length * 9}rem` }}>
                <span aria-hidden className="absolute top-3 h-px bg-border" style={{ left: inset, right: inset }} />
                {steps.map((step, index) => (
                    <li key={step.title} className="relative flex flex-col items-center gap-1 px-1 text-center">
                        <span className={cn('mb-2 flex size-6 items-center justify-center rounded-full ring-1', index === 0 ? 'bg-foreground text-background ring-foreground' : 'bg-popover ring-border')}>
                            {index === 0 ? <CheckIcon className="size-3.5" /> : <span className="size-1.5 rounded-full bg-muted-foreground" />}
                        </span>
                        <span className="text-xs text-muted-foreground">{step.when}</span>
                        <span className="text-sm font-medium">{step.title}</span>
                        <span className="text-xs text-muted-foreground">{step.detail}</span>
                    </li>
                ))}
            </ol>
        </div>
    )
}

export function IntervalToggle({ value, onChange, disabled }: { value: BillingInterval; onChange: (value: BillingInterval) => void; disabled?: boolean }) {
    const t = useTranslations('billing.parts.interval')
    return (
        <div className="inline-flex w-fit gap-1 rounded-xl bg-muted/60 p-1 ring-1 ring-border">
            {(['monthly', 'yearly'] as const).map(interval => (
                <button
                    key={interval}
                    type="button"
                    disabled={disabled}
                    aria-pressed={value === interval}
                    onClick={() => onChange(interval)}
                    className={cn(
                        'flex h-8 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:opacity-60',
                        value === interval ? 'bg-foreground text-background shadow-[var(--relief-solid)]' : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    {interval === 'monthly' ? t('monthly') : t('yearly')}
                    {interval === 'yearly' && (
                        <Badge size="xs" tone="green" className={cn(value === interval && 'dark:[--badge-fg:#047857]!')}>
                            -{yearlyDiscountPercent()}%
                        </Badge>
                    )}
                </button>
            ))}
        </div>
    )
}

const RICH_STRONG = { b: (chunks: ReactNode) => <span className="font-medium text-foreground">{chunks}</span> }

// On a free trial the lines that differ from Pro say the trial's own limits first: the card sits under
// a subtitle quoting them, and Pro's figures alone would read as what the trial gives.
function features(t: ReturnType<typeof useTranslations<'billing.parts.features'>>, freeTrial: boolean): { id: string; icon: LucideIcon; text: ReactNode }[] {
    if (freeTrial) {
        return [
            { id: 'agents', icon: CpuIcon, text: t.rich('trial.agents', { ...RICH_STRONG, count: TRIAL_ACTIVE_AGENTS }) },
            { id: 'teammates', icon: UserPlus, text: t.rich('trial.teammates', RICH_STRONG) },
            { id: 'runs', icon: Repeat, text: t.rich('runs', RICH_STRONG) },
            { id: 'credit', icon: CoinsIcon, text: t.rich('trial.credit', { ...RICH_STRONG, credits: TRIAL_CREDITS, monthly: BASE_PLAN_CREDITS }) },
            { id: 'models', icon: BrainIcon, text: t.rich('models', RICH_STRONG) },
            { id: 'autopilot', icon: ZapIcon, text: t.rich('autopilot', RICH_STRONG) },
        ]
    }
    return [
        { id: 'agents', icon: CpuIcon, text: t.rich('pro.agents', RICH_STRONG) },
        { id: 'teammates', icon: UserPlus, text: t.rich('pro.teammates', RICH_STRONG) },
        { id: 'runs', icon: Repeat, text: t.rich('runs', RICH_STRONG) },
        { id: 'credit', icon: CoinsIcon, text: t.rich('pro.credit', { ...RICH_STRONG, credits: BASE_PLAN_CREDITS }) },
        { id: 'models', icon: BrainIcon, text: t.rich('models', RICH_STRONG) },
        { id: 'autopilot', icon: ZapIcon, text: t.rich('autopilot', RICH_STRONG) },
    ]
}

function FeatureGrid({ freeTrial = false }: { freeTrial?: boolean }) {
    const t = useTranslations('billing.parts.features')
    return (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-2.5 lg:grid-cols-2">
            {features(t, freeTrial).map(feature => (
                <li key={feature.id} className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Icon size="sm" icon={feature.icon} />
                    <span>{feature.text}</span>
                </li>
            ))}
        </ul>
    )
}

// The plan: its name and billing on the left, the price per month on the right. `discountCents` is
// what comes off each invoice for a workspace grandfathered on a legacy price or holding a permanent
// promo. `freeTrial` prices the card at what the trial costs, the plan's price struck beside it.
// `priceArm` is the price this workspace is sold the base plan at.
export function PlanCard({ interval, priceArm = DEFAULT_PRICE_ARM, discountCents = 0, freeTrial = false }: { interval: BillingInterval; priceArm?: PriceArm; discountCents?: number; freeTrial?: boolean }) {
    const t = useTranslations('billing.parts.plan')
    const quantities = ZERO_QUANTITIES
    const periodCents = Math.max(0, planPriceCents(quantities, interval, priceArm) - discountCents)
    const monthCents = interval === 'yearly' ? Math.round(periodCents / 12) : periodCents
    const struckListPrice = freeTrial || interval === 'yearly' || discountCents > 0
    const billing = interval === 'yearly' ? t.rich('billedYearly', { amount: () => <UsdFlow cents={periodCents} /> }) : t('billedMonthly')
    return (
        <div className="relative flex flex-col gap-5 rounded-2xl bg-background/60 p-5 ring-1 ring-border sm:p-6">
            <BorderBeam />
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                <div className="flex min-w-0 items-center gap-4">
                    <Icon size="lg" icon={Package} />
                    <div className="min-w-0">
                        <p className="text-lg font-medium">{t('title')}</p>
                        <p className="text-sm text-muted-foreground">
                            {freeTrial ? t('freeTrialLine') : t('unlimited')} · {billing}
                        </p>
                    </div>
                </div>
                <div className="ml-auto min-w-0 text-right">
                    <p className="flex items-baseline justify-end gap-2">
                        <span className="text-2xl font-semibold sm:text-3xl tracking-tight tabular-nums">
                            <UsdFlow cents={freeTrial ? 0 : monthCents} />
                        </span>
                        {struckListPrice && (
                            // A drawn strike: `line-through` does not reach NumberFlow's inline-block digits.
                            <span className="relative text-base text-muted-foreground tabular-nums after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-current">
                                <UsdFlow cents={perMonthCents(quantities, 'monthly', priceArm)} />
                            </span>
                        )}
                    </p>
                    <p className="text-sm text-muted-foreground">{freeTrial ? t('forDays', { days: TRIAL_DAYS }) : t('perMonth')}</p>
                </div>
            </div>
            <FeatureGrid freeTrial={freeTrial} />
        </div>
    )
}

const ROTATE_MS = 6000

// Social proof under the plan: one segment per quote, the active one fills while it shows. A build
// without quotes shows nothing.
export function TestimonialStrip() {
    return TESTIMONIALS.length ? <TestimonialRotation /> : null
}

function TestimonialRotation() {
    const t = useTranslations('billing.parts')
    const locale = useLocale()
    const [index, setIndex] = useState(0)
    const [elapsed, setElapsed] = useState(0)

    useEffect(() => {
        const startedAt = performance.now()
        const timer = setInterval(() => {
            const percent = ((performance.now() - startedAt) / ROTATE_MS) * 100
            if (percent < 100) return setElapsed(percent)
            setElapsed(0)
            setIndex(current => (current + 1) % TESTIMONIALS.length)
        }, 100)
        return () => clearInterval(timer)
    }, [index])

    const show = (next: number) => {
        setElapsed(0)
        setIndex(next)
    }

    const testimonial = TESTIMONIALS[index]
    const copy = testimonialCopy(testimonial, locale)

    return (
        <figure className="mt-auto flex flex-col gap-4 rounded-2xl bg-background/40 p-4 ring-1 ring-border">
            <div className="flex gap-2">
                {TESTIMONIALS.map((item, itemIndex) => (
                    <button key={item.id} type="button" aria-label={t('showTestimonial', { company: item.company })} onClick={() => show(itemIndex)} className="flex h-4 flex-1 items-center">
                        <Progress value={itemIndex === index ? elapsed : 0} size="sm" label={item.company} />
                    </button>
                ))}
            </div>
            <AnimatePresence mode="wait" initial={false}>
                <motion.div key={testimonial.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }} className="flex flex-col gap-4">
                    <blockquote className="line-clamp-2 min-h-12 text-[15px] leading-6">{t('quoted', { quote: copy.quote })}</blockquote>
                    <figcaption className="flex items-center gap-2.5 text-sm">
                        <ExpertAvatar initials={initialsFromName(testimonial.author)} src={testimonial.avatar} alt={testimonial.author} rounded="rounded-full" className="size-7 shrink-0 text-[10px]" />
                        <span className="font-medium">{testimonial.author}</span>
                        <span className="truncate text-muted-foreground">· {copy.role}</span>
                        {testimonial.companyLogo ? (
                            // eslint-disable-next-line @next/next/no-img-element -- a company mark bundled with the testimonial, sized by CSS
                            <img src={testimonial.companyLogo} alt={testimonial.company} className="ml-auto size-5 object-contain" />
                        ) : (
                            <span className="ml-auto shrink-0 text-xs font-medium text-muted-foreground">{testimonial.company}</span>
                        )}
                    </figcaption>
                </motion.div>
            </AnimatePresence>
        </figure>
    )
}

export function PayHeader({ title, amount, unit }: { title: string; amount: ReactNode; unit: string }) {
    return (
        <div className="flex items-center gap-4">
            <Icon size="lg" icon={Package} />
            <div>
                <p className="text-sm text-muted-foreground">{title}</p>
                <div className="text-2xl font-semibold tabular-nums">
                    {amount} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
                </div>
            </div>
        </div>
    )
}

export type SummaryRow = { label: string; value: ReactNode; strong?: boolean; muted?: boolean }

export function SummaryRows({ rows }: { rows: SummaryRow[] }) {
    return (
        <dl className="flex flex-col divide-y divide-border rounded-xl bg-background/60 ring-1 ring-border">
            {rows.map(row => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
                    <dt className={cn(row.strong ? 'font-medium' : 'text-muted-foreground')}>{row.label}</dt>
                    <dd className={cn('text-right tabular-nums', row.strong && 'font-medium', row.muted && 'text-muted-foreground')}>{row.value}</dd>
                </div>
            ))}
        </dl>
    )
}

export type SavedCardView = { brand: string; last4: string }

export function CardOnFile({ card, action, onAction }: { card: SavedCardView | null; action?: string; onAction?: () => void }) {
    const t = useTranslations('billing.parts')
    return (
        <div className="flex items-center justify-between rounded-xl bg-background/60 px-4 py-3 text-sm ring-1 ring-border">
            <span className="flex items-center gap-3">
                <CreditCardIcon className="size-4 text-muted-foreground" />
                {card ? (
                    <span>
                        <span className="capitalize">{card.brand}</span> •••• {card.last4}
                    </span>
                ) : (
                    <span className="text-muted-foreground">{t('cardOnFile')}</span>
                )}
            </span>
            {action && onAction && (
                <button type="button" onClick={onAction} className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
                    {action}
                </button>
            )}
        </div>
    )
}

export type AppliedPromoCode = { code: string; discount: string }

// `onApply` and `onRemove` answer the message to show when Stripe refuses, null when it went through.
export function PromoCodeField({
    applied,
    onApply,
    onRemove,
    disabled,
    defaultOpen = false,
}: {
    applied: AppliedPromoCode | null
    onApply: (code: string) => Promise<string | null>
    onRemove: () => Promise<string | null>
    disabled?: boolean
    defaultOpen?: boolean
}) {
    const t = useTranslations('billing.parts.promo')
    const [open, setOpen] = useState(defaultOpen)
    const [code, setCode] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const entered = code.trim()

    const apply = async () => {
        if (!entered || pending || disabled) return
        setPending(true)
        setError(null)
        const refusal = await onApply(entered)
        setPending(false)
        if (refusal) return setError(refusal)
        setCode('')
        setOpen(false)
    }

    const remove = async () => {
        setPending(true)
        setError(null)
        const refusal = await onRemove()
        setPending(false)
        setError(refusal)
    }

    if (applied) {
        return (
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                        <Badge size="sm" tone="green">
                            {applied.code}
                        </Badge>
                        <span className="text-muted-foreground tabular-nums">{applied.discount}</span>
                    </span>
                    <button type="button" aria-label={t('remove')} onClick={() => void remove()} disabled={pending || disabled} className="text-muted-foreground hover:text-foreground disabled:opacity-60">
                        {pending ? <Loader2Icon className="size-4 animate-spin" /> : <XIcon className="size-4" />}
                    </button>
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
        )
    }

    if (!open) {
        return (
            <button type="button" onClick={() => setOpen(true)} disabled={disabled} className="self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60">
                {t('add')}
            </button>
        )
    }

    return (
        <Field label={t('label')} htmlFor="promo-code" error={error ?? undefined}>
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <Input
                        id="promo-code"
                        autoFocus
                        autoComplete="off"
                        value={code}
                        onChange={event => setCode(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter') void apply()
                        }}
                        disabled={pending || disabled}
                    />
                </div>
                <Button variant="outline" onClick={() => void apply()} disabled={!entered || pending || disabled}>
                    {pending && <Loader2Icon className="animate-spin" />}
                    {t('apply')}
                </Button>
            </div>
        </Field>
    )
}

export function PayFooter({
    cta,
    footnote,
    onClick,
    loading,
    disabled,
    disabledReason,
    error,
    children,
}: {
    cta: string
    footnote?: ReactNode
    onClick?: () => void
    loading?: boolean
    disabled?: boolean
    disabledReason?: string
    error?: ReactNode
    children?: ReactNode
}) {
    return (
        <div className="mt-auto flex flex-col gap-3 pt-6">
            {children}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <TooltipDisabledReason reason={disabled ? disabledReason : undefined} className="w-full">
                <Button size="lg" className="h-11 w-full text-base" onClick={onClick} disabled={disabled || loading}>
                    {loading && <Loader2Icon className="animate-spin" />}
                    {cta}
                </Button>
            </TooltipDisabledReason>
            {footnote && <p className="text-center text-xs text-muted-foreground">{footnote}</p>}
        </div>
    )
}

export function SuccessPanel({ title, body, rows, cta, onDone, loading }: { title: string; body: string; rows?: SummaryRow[]; cta: string; onDone: () => void; loading?: boolean }) {
    return (
        <div className="flex flex-1 flex-col">
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-green-500/15 text-green-500 ring-1 ring-green-500/30">
                    <CheckIcon className="size-6" />
                </span>
                <h3 className="text-2xl font-semibold tracking-tight">{title}</h3>
                <p className="max-w-xs text-sm text-muted-foreground">{body}</p>
                {rows && (
                    <div className="mt-2 w-full text-left">
                        <SummaryRows rows={rows} />
                    </div>
                )}
            </div>
            <PayFooter cta={cta} onClick={onDone} loading={loading} />
        </div>
    )
}

export function Notice({ tone, children }: { tone: 'warning' | 'danger'; children: ReactNode }) {
    return (
        <div className={cn('flex gap-3 rounded-xl p-4 text-sm ring-1', tone === 'danger' ? 'bg-destructive/10 ring-destructive/30' : 'bg-orange-400/10 ring-orange-400/30')}>
            <TriangleAlertIcon className={cn('mt-0.5 size-4 shrink-0', tone === 'danger' ? 'text-destructive' : 'text-orange-400')} />
            <p>{children}</p>
        </div>
    )
}

export function RightTitle({ children, onBack, backLabel }: { children: ReactNode; onBack?: () => void; backLabel?: string }) {
    const t = useTranslations('billing.parts')
    return (
        <div className="flex flex-col gap-2">
            {onBack && (
                <button type="button" onClick={onBack} className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="size-3.5" />
                    {backLabel ?? t('backToPlan')}
                </button>
            )}
            <h3 className="text-lg font-semibold">{children}</h3>
        </div>
    )
}

// The immediate-performance acknowledgement the hosted Checkout used to print above its button. The
// Elements mode refuses Stripe's `custom_text`, so the dialog asks for it itself.
export function TermsConsent({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
    const t = useTranslations('billing.parts')
    return (
        <label className="flex cursor-pointer items-start gap-3 text-xs text-muted-foreground">
            <Checkbox size="sm" checked={checked} onCheckedChange={value => onChange(value === true)} className="mt-0.5 shrink-0" />
            <span>
                {t.rich('terms', {
                    terms: chunks => (
                        <a href={landingUrl('/terms')} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
                            {chunks}
                        </a>
                    ),
                })}
            </span>
        </label>
    )
}
