'use client'

import type { CancelFlowState } from '@/ee/services/billing.service'
import type { CancelFlowActivity } from '@/ee/services/cancel-flow-activity.service'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { CANCEL_COMEBACKS, cancelReasonTextSchema, type CancelComeback, type CancelReason } from '@/ee/lib/billing/cancel-flow'
import { PLAN_CURRENCY } from '@/ee/lib/billing/plans'
import { fireRerunConfetti } from '@/lib/confetti'
import { ActivityIcon, BellIcon, CalendarIcon, CircleCheckIcon, CoinsIcon, HeartIcon, LockIcon, ShieldCheckIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { zodResolver } from '@hookform/resolvers/zod'
import { track } from '@rerun/analytics/client'
import { formatAmount } from '@rerun/contracts'
import { formatNumber } from '@rerun/i18n/format'
import { OptionRow } from '@rerun/ui/chat'
import { Icon } from '@rerun/ui/primitives'
import { TemplateBoardPreview, type BoardAgent } from '@rerun/ui/iso-grid'
import { StepTransition, useStepper } from '@rerun/ui/steps'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { CancelNote, DaysLeftCard, OfferCard, SunkCard, type IconType, type SunkStat } from './CancelFlowCards'
import { CancelTimeline, type CancelMilestone } from './CancelTimeline'
import { CANCEL_STEPS, COMEBACK_OPTIONS, daysBetween, shortDate, type CancelOutcome, type CancelStep } from './cancel-flow-copy'

type BillingT = ReturnType<typeof useTranslations<'billing'>>

const REASON_MAX_LENGTH = cancelReasonTextSchema.maxLength ?? 1000

function reasonSchemaOf(t: BillingT) {
    return z.object({
        comment: z
            .string()
            .trim()
            .min(1, t('cancel.reason.required'))
            .max(REASON_MAX_LENGTH, t('cancel.reason.tooLong', { max: REASON_MAX_LENGTH })),
        comeback: z.enum(CANCEL_COMEBACKS),
    })
}

type ReasonValues = z.infer<ReturnType<typeof reasonSchemaOf>>

// An answer that does not read as a reason is turned down this many times, then let through: the
// check is there to get a real answer, never to keep someone from cancelling.
const MAX_REASON_REFUSALS = 2

export type CancelInput = { comeback: CancelComeback; comment: string }

export type CancelReasonCheckResult = { genuine: boolean; reason: CancelReason }

export type CancelFlowProps = {
    state: CancelFlowState
    activity: CancelFlowActivity | null
    activityLoading: boolean
    agentCount: number
    creditLeftLabel: string
    // Each resolves to whether it went through; the flow only moves on when it did.
    onRemind: () => Promise<boolean>
    onClaim: () => Promise<boolean>
    onCancel: (input: CancelInput) => Promise<boolean>
    // null when the answer could not be read at all, which lets it through.
    onCheckReason: (text: string) => Promise<CancelReasonCheckResult | null>
    onResume: () => Promise<boolean>
    onClose: () => void
    onStepChange: (step: CancelStep) => void
}

type Header = { icon: IconType; title: string; description: string }

export function CancelFlow({ state, activity, activityLoading, agentCount, creditLeftLabel, onRemind, onClaim, onCancel, onCheckReason, onResume, onClose, onStepChange }: CancelFlowProps) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const firstStep: CancelStep = state.reminderAt ? 'goodbye' : 'sunk'
    const stepper = useStepper(CANCEL_STEPS.length, CANCEL_STEPS.indexOf(firstStep))
    const step = CANCEL_STEPS[stepper.index]
    const [outcome, setOutcome] = useState<CancelOutcome>('cancelled')
    const [busy, setBusy] = useState(false)
    const [boardQuiet, setBoardQuiet] = useState(false)
    const [accepted, setAccepted] = useState<{ text: string; reason: CancelReason } | null>(null)
    const [refusals, setRefusals] = useState(0)

    const reasonSchema = useMemo(() => reasonSchemaOf(t), [t])
    const form = useForm<ReasonValues>({ resolver: zodResolver(reasonSchema), mode: 'onChange', defaultValues: { comment: '' } })
    const comment = useWatch({ control: form.control, name: 'comment' })
    const comeback = useWatch({ control: form.control, name: 'comeback' })
    const reason = accepted?.reason
    const reasonMissing = !comment.trim() ? t('cancel.reason.missingComment') : !comeback ? t('cancel.reason.missingComeback') : undefined

    const trial = state.phase === 'trial'
    const endsOn = shortDate(state.endsAt, locale)
    const keptUntil = shortDate(state.keptUntil, locale)
    const reminderOn = state.reminderAt ? shortDate(state.reminderAt, locale) : null
    const offer = state.offer
    const offerCopy = offer ? offerCopyOf(t, offer, endsOn, locale) : null

    useEffect(() => onStepChange(step), [step, onStepChange])

    useEffect(() => {
        if (step === 'offer' && offer && reason) track('retention_offer_shown', { phase: state.phase, reason, offer: offer.kind })
    }, [step, offer, reason, state.phase])

    const goTo = (target: CancelStep) => stepper.goTo(CANCEL_STEPS.indexOf(target))

    const finish = (next: CancelOutcome) => {
        setOutcome(next)
        goTo('done')
        if (next === 'claimed') void fireRerunConfetti()
    }

    const run = async (action: () => Promise<boolean>, next: CancelOutcome) => {
        if (busy) return
        setBusy(true)
        const ok = await action()
        setBusy(false)
        if (ok) finish(next)
    }

    const remind = () => run(onRemind, 'reminded')

    const claim = () =>
        run(async () => {
            const ok = await onClaim()
            if (ok && offer && reason) track('retention_offer_accepted', { phase: state.phase, reason, offer: offer.kind })
            return ok
        }, 'claimed')

    const declineOffer = () => {
        if (offer && reason) track('retention_offer_declined', { phase: state.phase, reason, offer: offer.kind })
        goTo('farewell')
    }

    const cancel = () => {
        const values = form.getValues()
        return run(() => onCancel({ comeback: values.comeback, comment: values.comment.trim() }), 'cancelled')
    }

    const resume = async () => {
        if (busy) return
        setBusy(true)
        const ok = await onResume()
        setBusy(false)
        if (ok) onClose()
    }

    const continueFromReason = form.handleSubmit(async values => {
        if (busy) return
        const text = values.comment.trim()
        if (accepted?.text !== text) {
            setBusy(true)
            const check = await onCheckReason(text)
            setBusy(false)
            if (check && !check.genuine && refusals < MAX_REASON_REFUSALS) {
                setRefusals(count => count + 1)
                form.setError('comment', { message: t('cancel.reason.notAReason') })
                return
            }
            setAccepted({ text, reason: check?.genuine ? check.reason : 'other' })
        }
        goTo(offer ? 'offer' : 'farewell')
    })

    const goBack = () => {
        if (step === firstStep) return onClose()
        if (step === 'farewell' && !offer) return goTo('reason')
        stepper.back()
    }

    const header = ((): Header => {
        if (step === 'goodbye') {
            return { icon: BellIcon, title: t('cancel.header.goodbyeTitle', { date: reminderOn ?? '' }), description: trial ? t('cancel.header.goodbyeTrialDescription') : t('cancel.header.goodbyePaidDescription') }
        }
        if (step === 'sunk') {
            return trial
                ? { icon: LockIcon, title: t('cancel.header.sunkTrialTitle'), description: t('cancel.header.sunkTrialDescription') }
                : { icon: LockIcon, title: t('cancel.header.sunkPaidTitle'), description: t('cancel.header.sunkPaidDescription', { date: endsOn }) }
        }
        if (step === 'reason') return { icon: HeartIcon, title: t('cancel.header.reasonTitle'), description: t('cancel.header.reasonDescription') }
        if (step === 'offer') return { icon: HeartIcon, title: t(`cancel.offerTitle.${reason ?? 'other'}`), description: t('cancel.header.offerDescription') }
        if (step === 'farewell') {
            return { icon: LockIcon, title: t('cancel.header.farewellTitle', { date: endsOn }), description: t('cancel.header.farewellDescription') }
        }
        if (outcome === 'claimed') return { icon: CircleCheckIcon, title: t('cancel.header.claimedTitle'), description: t('cancel.header.claimedDescription') }
        if (outcome === 'reminded') return { icon: BellIcon, title: t('cancel.header.remindedTitle', { date: reminderOn ?? '' }), description: t('cancel.header.remindedDescription') }
        return { icon: CircleCheckIcon, title: t('cancel.header.cancelledTitle'), description: t('cancel.header.cancelledDescription', { date: endsOn }) }
    })()

    const milestones = useMemo((): CancelMilestone[] => {
        if (!state.reminderAt) return []
        const now = Date.parse(state.now)
        const end = Date.parse(state.endsAt)
        return [
            { at: 0, label: t('cancel.milestones.youStay'), date: new Date(now) },
            { at: (Date.parse(state.reminderAt) - now) / (end - now), label: trial ? t('cancel.milestones.email') : t('cancel.milestones.reminder'), date: new Date(state.reminderAt), highlighted: true },
            { at: 1, label: trial ? t('cancel.milestones.firstCharge') : t('cancel.milestones.renewal'), date: new Date(end) },
        ]
    }, [state.now, state.reminderAt, state.endsAt, trial, t])

    const boardAgents = useMemo((): BoardAgent[] => (activity?.agents ?? []).map(({ key, name, connectorSlugs }) => ({ key, name, connectorSlugs })), [activity])

    const sunk = sunkFigures({ t, trial, state, activity, agentCount, creditLeftLabel, locale })
    const contentKey = `${step}-${outcome}`

    return (
        <div className="flex min-h-0 flex-col">
            <div className="px-6 pt-6 pb-6">
                <DialogHeader className="mb-5 gap-0">
                    <StepTransition stepKey={contentKey} direction={stepper.direction} variant="header" className="flex flex-col gap-1.5 pr-6">
                        <Icon icon={header.icon} size="sm" className="mb-2" />
                        <DialogTitle className="text-2xl leading-tight font-semibold tracking-tight text-balance">{header.title}</DialogTitle>
                        <DialogDescription>{header.description}</DialogDescription>
                    </StepTransition>
                </DialogHeader>

                <StepTransition stepKey={contentKey} direction={stepper.direction}>
                    {step === 'goodbye' && (
                        <div className="flex flex-col gap-5">
                            <DaysLeftCard trial={trial} daysLeft={daysBetween(state.now, state.endsAt)} agents={activity?.agents ?? []} loading={activityLoading} />
                            <CancelTimeline milestones={milestones} />
                            <Button size="lg" highlight className="w-full" disabled={busy} onClick={remind}>
                                <BellIcon />
                                {t('cancel.remindMe', { date: reminderOn ?? '' })}
                            </Button>
                        </div>
                    )}
                    {step === 'sunk' && (
                        <div className="flex flex-col gap-5">
                            <SunkCard value={sunk.value} caption={sunk.caption} stats={sunk.stats} loading={activityLoading} />
                            <Button size="lg" highlight className="w-full" onClick={onClose}>
                                {t('cancel.keepRunning')}
                            </Button>
                        </div>
                    )}
                    {step === 'reason' && (
                        <Form {...form}>
                            <form onSubmit={continueFromReason} className="flex flex-col gap-5">
                                <FormField
                                    control={form.control}
                                    name="comment"
                                    render={({ field }) => (
                                        <FormItem>
                                            <Field label={t('cancel.reason.field')}>
                                                <FormControl>
                                                    <Textarea rows={4} placeholder={t('cancel.reason.placeholder')} disabled={busy} {...field} />
                                                </FormControl>
                                            </Field>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <Field label={t('cancel.reason.comebackField')}>
                                    <div className="-mx-2 space-y-0.5">
                                        {COMEBACK_OPTIONS.map((option, index) => (
                                            <OptionRow key={option} index={index} label={t(`cancel.comeback.${option}`)} selected={comeback === option} onChoose={() => form.setValue('comeback', option, { shouldValidate: true })} />
                                        ))}
                                    </div>
                                </Field>
                            </form>
                        </Form>
                    )}
                    {step === 'offer' && offer && offerCopy && (
                        <div className="flex flex-col gap-5">
                            <OfferCard headline={offerCopy.headline} priceLabel={offerCopy.priceLabel} fullPriceLabel={offerCopy.fullPriceLabel} billedOnLabel={shortDate(offer.billedOn, locale)} terms={offerCopy.terms} />
                            <Button size="lg" highlight className="w-full" disabled={busy} onClick={claim}>
                                {offerCopy.claimLabel}
                            </Button>
                        </div>
                    )}
                    {step === 'farewell' && (
                        <div className="flex flex-col gap-4">
                            {activityLoading ? (
                                <Skeleton className="h-44 rounded-xl" />
                            ) : (
                                boardAgents.length > 0 && (
                                    <div className={cn('relative h-44 overflow-hidden rounded-xl bg-muted/40 transition-[filter,opacity] duration-700', boardQuiet && 'opacity-35 grayscale')}>
                                        <TemplateBoardPreview agents={boardAgents} connectors={activity?.connectors ?? []} alive={!boardQuiet} maxZoom={3} className="size-full" />
                                    </div>
                                )
                            )}
                            <CancelNote icon={ShieldCheckIcon} title={t('cancel.saved.title', { date: keptUntil })} description={t('cancel.saved.description')} />
                            <Button size="lg" highlight className="w-full" onClick={onClose}>
                                {t('cancel.keepCoworkers')}
                            </Button>
                        </div>
                    )}
                    {step === 'done' && <DoneBody trial={trial} outcome={outcome} endsOn={endsOn} keptUntil={keptUntil} reminderOn={reminderOn} claimedDescription={offerCopy?.claimedDescription ?? null} claimedTitle={offerCopy?.headline ?? null} />}
                </StepTransition>
            </div>

            <DialogFooter className={cn('m-0 px-6 py-4', step !== 'done' && 'sm:justify-between')}>
                {step === 'done' ? (
                    <>
                        {outcome === 'cancelled' && (
                            <Button variant="outline" disabled={busy} onClick={resume}>
                                {trial ? t('cancel.buttons.resumeTrial') : t('cancel.buttons.resumeSubscription')}
                            </Button>
                        )}
                        <Button onClick={onClose}>{t('cancel.buttons.done')}</Button>
                    </>
                ) : (
                    <>
                        <Button variant="ghost" disabled={busy} onClick={goBack}>
                            {t('cancel.buttons.goBack')}
                        </Button>
                        {step === 'goodbye' && (
                            <Button variant="outline" disabled={busy} onClick={stepper.goForward}>
                                {t('cancel.buttons.continueToCancel')}
                            </Button>
                        )}
                        {step === 'sunk' && (
                            <Button variant="outline" onClick={stepper.goForward}>
                                {t('cancel.buttons.continue')}
                            </Button>
                        )}
                        {step === 'reason' && (
                            <TooltipDisabledReason reason={reasonMissing}>
                                <Button variant="outline" disabled={!!reasonMissing || busy} onClick={() => void continueFromReason()}>
                                    {t('cancel.buttons.continue')}
                                </Button>
                            </TooltipDisabledReason>
                        )}
                        {step === 'offer' && (
                            <Button variant="outline" disabled={busy} onClick={declineOffer}>
                                {t('cancel.buttons.noThanks')}
                            </Button>
                        )}
                        {step === 'farewell' && (
                            <Button
                                variant="destructive"
                                disabled={busy}
                                onMouseEnter={() => setBoardQuiet(true)}
                                onMouseLeave={() => setBoardQuiet(false)}
                                onFocus={() => setBoardQuiet(true)}
                                onBlur={() => setBoardQuiet(false)}
                                onClick={() => void cancel()}
                            >
                                {trial ? t('cancel.buttons.cancelTrial') : t('cancel.buttons.cancelSubscription')}
                            </Button>
                        )}
                    </>
                )}
            </DialogFooter>
        </div>
    )
}

type OfferCopy = { headline: string; priceLabel: string; fullPriceLabel: string; terms: string; claimLabel: string; claimedDescription: string }

function offerCopyOf(t: BillingT, offer: NonNullable<CancelFlowState['offer']>, endsOn: string, locale: string): OfferCopy {
    const price = formatAmount(offer.priceCents, PLAN_CURRENCY)
    const full = formatAmount(offer.fullPriceCents, PLAN_CURRENCY)
    const fullFrom = shortDate(offer.fullPriceFrom, locale)

    if (offer.kind === 'trial_half') {
        return {
            headline: t('cancel.offer.trialHalf.headline'),
            priceLabel: price,
            fullPriceLabel: full,
            terms: t('cancel.offer.trialHalf.terms', { full, fullFrom, endsOn }),
            claimLabel: t('cancel.offer.trialHalf.claim'),
            claimedDescription: t('cancel.offer.trialHalf.claimed', { price, endsOn, full }),
        }
    }

    // The $1 is the base plan's price: with add-ons the card shows the base plan against its list
    // price, and the add-ons, billed as usual, are spelled out underneath.
    const addonsCents = offer.fullPriceCents - offer.basePriceCents
    return {
        headline: t('cancel.offer.nextMonth.headline'),
        priceLabel: formatAmount(offer.priceCents - addonsCents, PLAN_CURRENCY),
        fullPriceLabel: formatAmount(offer.basePriceCents, PLAN_CURRENCY),
        terms: addonsCents > 0 ? t('cancel.offer.nextMonth.termsWithAddons', { addons: formatAmount(addonsCents, PLAN_CURRENCY), full, fullFrom }) : t('cancel.offer.nextMonth.terms', { full, fullFrom }),
        claimLabel: t('cancel.offer.nextMonth.claim'),
        claimedDescription: t('cancel.offer.nextMonth.claimed', { price, full, fullFrom }),
    }
}

function sunkFigures({ t, trial, state, activity, agentCount, creditLeftLabel, locale }: { t: BillingT; trial: boolean; state: CancelFlowState; activity: CancelFlowActivity | null; agentCount: number; creditLeftLabel: string; locale: string }): {
    value: string
    caption: string
    stats: SunkStat[]
} {
    const runs = activity ? formatNumber(activity.runsMonth, locale) : null

    if (!trial) {
        return {
            value: formatAmount(state.paidLeftCents, PLAN_CURRENCY),
            caption: t('cancel.sunk.paidCaption'),
            stats: [
                { icon: CoinsIcon, label: t('cancel.sunk.creditsLeft'), value: creditLeftLabel },
                { icon: ActivityIcon, label: t('cancel.sunk.runsThisMonth'), value: runs },
            ],
        }
    }

    return {
        value: agentCount > 0 ? t('cancel.sunk.agents', { count: agentCount }) : creditLeftLabel,
        caption: agentCount > 0 ? t('cancel.sunk.agentsCaption') : t('cancel.sunk.creditsCaption'),
        stats: [
            { icon: ActivityIcon, label: t('cancel.sunk.runsSoFar'), value: runs },
            { icon: CalendarIcon, label: t('cancel.sunk.schedules'), value: activity ? formatNumber(activity.schedules, locale) : null },
        ],
    }
}

function DoneBody({
    trial,
    outcome,
    endsOn,
    keptUntil,
    reminderOn,
    claimedTitle,
    claimedDescription,
}: {
    trial: boolean
    outcome: CancelOutcome
    endsOn: string
    keptUntil: string
    reminderOn: string | null
    claimedTitle: string | null
    claimedDescription: string | null
}) {
    const t = useTranslations('billing')
    if (outcome === 'reminded') {
        return <CancelNote icon={BellIcon} title={t('cancel.done.emailTitle', { date: reminderOn ?? '' })} description={trial ? t('cancel.done.emailTrialDescription') : t('cancel.done.emailPaidDescription', { date: endsOn })} />
    }

    if (outcome === 'claimed' && claimedTitle && claimedDescription) return <CancelNote icon={CircleCheckIcon} title={claimedTitle} description={claimedDescription} />

    return (
        <div className="flex flex-col gap-3">
            <CancelNote icon={CalendarIcon} title={t('cancel.done.activeTitle', { date: endsOn })} description={trial ? t('cancel.done.activeTrialDescription') : t('cancel.done.activePaidDescription')} />
            <CancelNote icon={ShieldCheckIcon} title={t('cancel.done.changedMindTitle')} description={t('cancel.done.changedMindDescription', { endsOn, keptUntil })} />
        </div>
    )
}
