'use client'

import { track } from '@rerun/analytics/client'
import { TESTIMONIALS } from '@rerun/cloud/testimonials'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { RerunOnly } from '@/components/brand/RerunOnly'
import { OnboardingHeading, OnboardingStepLayout } from '@/components/onboarding/OnboardingPage'
import { ProofQuote } from '@/components/onboarding/ProofQuote'
import { TrustStrip } from '@/components/onboarding/TrustStrip'
import { Button } from '@/components/ui/button'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { checkoutCopy, longDate, nextInvoiceDate, shortDate, type CheckoutContext } from '@/ee/components/dialogs/billing/checkout-copy'
import { BilledFlow, PlanCard, usd } from '@/ee/components/dialogs/billing/parts'
import { SubscribePane, type SubscribeSubmit } from '@/ee/components/dialogs/billing/SubscribeCheckout'
import { checkoutRouteFor, trialOffer } from '@/ee/lib/billing/checkout-variant'
import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { BASE_PLAN_SLUG, INCLUDED_MACHINE_SIZE, ZERO_QUANTITIES, planPriceCents, trialEndDate } from '@/ee/lib/billing/plans'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { ArrowLeftIcon, CheckIcon, LockIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { hasPendingStart, useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'

type View = 'offer' | 'card'

// The trial as a step of the onboarding page: what it gives and when it bills first, then the card,
// one click further in the same card, the way back on both. The checkout is the billing dialog's,
// session, terms and outcome included; the flow moves on once the workspace turns entitled. A card
// that already had a trial turns the step to the paid plan, as the dialog does. On a phone the
// buttons ride the bottom of the screen and the proof the panel holds comes under the card.
export function OnboardingTrialStep({ onBack, waitlisted }: { onBack: () => void; waitlisted: boolean }) {
    const t = useTranslations('billing')
    const locale = useLocale()
    const { workspace, refreshWorkspace } = useSession()
    const { access, keptUntil } = useWorkspaceAccess()
    const parked = useOnboardingStore(s => hasPendingStart(s))
    const [view, setView] = useState<View>('offer')
    const [refused, setRefused] = useState(false)
    const [started, setStarted] = useState(false)
    const [openedAt] = useState(() => new Date())

    const route = checkoutRouteFor({
        status: workspace?.subscription_status,
        offer: refused ? 'paid' : trialOffer(workspace),
        paused: access === 'paused',
        hasPendingStart: parked,
        trigger: 'onboarding',
        hasStripePlan: false,
        hasPaymentMethod: false,
    })
    // Once the trial or the plan lands, the route reads an entitled workspace and would turn the step
    // into an upgrade while it slides out: the step keeps what it was selling until it is gone.
    const entitled = isSubscriptionEntitled(workspace?.subscription_status)
    const current = route?.variant ?? 'start_trial'
    const [kept, setKept] = useState(current)
    if (!entitled && current !== kept) setKept(current)
    const variant = entitled ? kept : current
    const trial = variant === 'start_trial'
    const listCents = planPriceCents(ZERO_QUANTITIES, 'monthly')
    const context: CheckoutContext = {
        billed: <BilledFlow cents={listCents} interval="monthly" />,
        nextInvoice: shortDate(nextInvoiceDate('monthly', openedAt), locale),
        trialEnds: shortDate(trialEndDate(openedAt), locale),
        trialDaysLeft: null,
        reminderOn: null,
        firstCharge: usd(listCents),
        trialCancelled: false,
        keptUntil: keptUntil ? longDate(keptUntil, locale) : null,
        parked: null,
        coworker: null,
    }
    const copy = checkoutCopy(t, variant, context)

    const reported = useRef(false)
    useEffect(() => {
        if (waitlisted || reported.current) return
        reported.current = true
        track('paywall_viewed', { trigger: 'onboarding', variant })
    }, [waitlisted, variant])

    const addCard = () => {
        track('checkout_started', { plan: BASE_PLAN_SLUG, source: 'onboarding' })
        setView('card')
    }

    return (
        <OnboardingStepLayout size="question" heading={<OnboardingHeading title={copy.title} subtitle={copy.subtitle} />} below={<ProofUnderCard />}>
            {view === 'offer' ? (
                <div className="flex flex-col gap-5">
                    <TrialTimeline steps={copy.timeline} />
                    <PlanCard interval="monthly" freeTrial={trial} compact />
                    <PinnedActions>
                        <div className="flex gap-2">
                            <BackButton onClick={onBack} />
                            <Button size="lg" className="flex-1" onClick={addCard}>
                                {trial ? t('onboardingTrial.addCardFree', { amount: usd(0) }) : t('onboardingTrial.addCard')}
                            </Button>
                        </div>
                    </PinnedActions>
                </div>
            ) : (
                <div className="flex flex-col">
                    <SubscribePane
                        key={variant}
                        selection={{ quantities: ZERO_QUANTITIES, interval: 'monthly', machineSize: INCLUDED_MACHINE_SIZE }}
                        copy={copy}
                        onDone={() => {
                            setStarted(true)
                            void refreshWorkspace()
                        }}
                        onTrialRefused={() => {
                            setRefused(true)
                            setView('offer')
                        }}
                        footer={submit => <CardActions submit={submit} started={started} onBack={() => setView('offer')} />}
                    />
                </div>
            )}
        </OnboardingStepLayout>
    )
}

// The three moments of the plan, one under the other and large: read before the plan, never wider
// than the column.
function TrialTimeline({ steps }: { steps: { when: string; title: string; detail: ReactNode }[] }) {
    return (
        <ol className="flex flex-col">
            {steps.map((step, index) => (
                <li key={step.title} className="relative flex gap-4 pb-6 last:pb-0">
                    {index < steps.length - 1 && <span aria-hidden className="absolute start-5 top-10 bottom-0 w-px -translate-x-1/2 bg-border rtl:translate-x-1/2" />}
                    <span className={cn('relative flex size-10 shrink-0 items-center justify-center rounded-full ring-1', index === 0 ? 'bg-foreground text-background ring-foreground' : 'bg-card ring-border')}>
                        {index === 0 ? <CheckIcon className="size-5" /> : <span className="size-2 rounded-full bg-muted-foreground" />}
                    </span>
                    <span className="min-w-0 pt-1">
                        <span className="flex flex-wrap items-baseline gap-x-2 text-lg">
                            <span className="font-medium">{step.title}</span>
                            <span className="text-sm text-muted-foreground">{step.when}</span>
                        </span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">{step.detail}</span>
                    </span>
                </li>
            ))}
        </ol>
    )
}

// The terms, then Back and the button that really starts the plan, with what it commits to under them.
// Once paid, the button keeps turning until the workspace turns entitled and the flow moves on. The
// buttons are a sibling of the card form, not nested under the terms: a sticky bar only rides the
// screen within its parent.
function CardActions({ submit, started, onBack }: { submit: SubscribeSubmit; started: boolean; onBack: () => void }) {
    const busy = submit.loading || started
    return (
        <>
            <div className="flex flex-col gap-4 pt-5 pb-4">
                {submit.consent}
                {submit.error && <p className="text-sm text-destructive">{submit.error}</p>}
            </div>
            <PinnedActions>
                <div className="flex flex-col gap-3">
                    <div className="flex gap-2">
                        <BackButton onClick={onBack} disabled={busy} />
                        <TooltipDisabledReason reason={submit.disabled && !busy ? submit.disabledReason : undefined} className="flex-1">
                            <Button size="lg" className="w-full flex-1 sm:min-w-48" onClick={submit.onClick} disabled={submit.disabled} loading={busy}>
                                {submit.cta}
                            </Button>
                        </TooltipDisabledReason>
                    </div>
                    {submit.footnote && (
                        <p className="text-center text-xs text-balance text-muted-foreground">
                            <LockIcon className="me-1.5 inline size-3 align-[-1px]" />
                            {submit.footnote}
                        </p>
                    )}
                </div>
            </PinnedActions>
        </>
    )
}

// Under `sm` the step's buttons ride the bottom edge of the screen, over the end of the card.
function PinnedActions({ children }: { children: ReactNode }) {
    return <div className="sticky bottom-0 z-10 -mx-5 -mb-5 rounded-b-2xl border-t border-border bg-card/90 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:static sm:m-0 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">{children}</div>
}

function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
    const t = useTranslations('onboarding')
    return (
        <Button variant="ghost" size="lg" className="px-3 text-muted-foreground sm:px-4" onClick={onClick} disabled={disabled}>
            <ArrowLeftIcon />
            <span className="max-sm:sr-only">{t('back')}</span>
        </Button>
    )
}

// The panel's proof where there is no panel: the faces and the count, then the same quotes, smaller.
function ProofUnderCard() {
    if (TESTIMONIALS.length === 0) return null
    return (
        <RerunOnly>
            <div className="flex w-full max-w-[34rem] flex-col items-center gap-6 lg:hidden">
                <TrustStrip />
                <div className="w-full px-1">
                    <ProofQuote />
                </div>
            </div>
        </RerunOnly>
    )
}
