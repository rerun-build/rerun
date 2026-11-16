'use client'

import type { OnboardingState, OnboardingStep } from '@rerun/contracts'
import { track } from '@rerun/analytics/client'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'

import { decideIndustryAction, saveForemanIntakeAction } from '@/app/api/_actions/foreman-intake.actions'
import { claimOnboardingEngineAction, installOnboardingArrivalAction, saveOnboardingInvitesAction, type ClaimOutcome } from '@/app/api/_actions/onboarding-dialog.actions'
import { ServersDialog } from '@/components/dialogs/ServersDialog'
import { Progress } from '@/components/ui/progress'
import { InviteEmailsField } from '@/components/dialogs/InviteEmailsField'
import { streamLiveDiscoveries } from '@/components/builder/discoveries/useCompanyDiscoveries'
import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { IntakeChoiceStep } from '@/components/foreman/intake/IntakeChoiceStep'
import { IntakeCompanyStep } from '@/components/foreman/intake/IntakeCompanyStep'
import { IntakeIndustryStep } from '@/components/foreman/intake/IntakeIndustryStep'
import { IntakeTextStep } from '@/components/foreman/intake/IntakeTextStep'
import { useForemanIntake } from '@/components/foreman/intake/useForemanIntake'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { accountLabel } from '@/lib/auth/placeholder-email'
import { ClockIcon, CreditCardIcon, DownloadIcon, GlobeIcon, LayersIcon, PhoneIcon, ServerIcon, UsersIcon } from '@/lib/icons'
import { intakePreviewPlan, rolesForIndustry, type ForemanIntake } from '@/lib/onboarding/intake'
import { ONBOARDING_TRIGGER, useBillingStore } from '@/stores/billing.store'
import { useForemanStore } from '@/stores/foreman.store'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { startTemplateCheckoutAction } from '@rerun/cloud/marketplace.client'
import { PhoneVerificationStep } from '@rerun/cloud/phone.client'
import { SERVERS_ENABLED } from '@rerun/cloud/servers'
import { StepSwap } from './StepSwap'

// The steps this dialog draws. The others close it until the pull request that brings them.
const DRAWN_STEPS: ReadonlySet<OnboardingStep> = new Set(['profile', 'phone', 'invite', 'waitlist', 'trial', 'claiming', 'installing'])

// The trial is today's checkout, unchanged: the dialog gives way to it while it is open.
export function onboardingDialogOpen(state: OnboardingState | null, checkoutOpen: boolean): boolean {
    if (!state?.dialog || !DRAWN_STEPS.has(state.step)) return false
    return !(state.step === 'trial' && checkoutOpen)
}

type IconGlyph = ComponentType<{ className?: string }>
type StepView = { key: string; icon: IconGlyph; title: string; description?: string; body: ReactNode; footer?: ReactNode }

function SignOutButton() {
    const t = useTranslations('onboarding.footer')
    const { signOut } = useSession()
    const [leaving, setLeaving] = useState(false)
    return (
        <Button
            type="button"
            variant="ghost"
            className="sm:mr-auto"
            loading={leaving}
            onClick={() => {
                setLeaving(true)
                void signOut()
            }}
        >
            {t('signOut')}
        </Button>
    )
}

// The welcome questions, asked by the app itself: the site, the line of work when there is no site,
// the role, the first name when the sign-up did not carry one. Written at once at the end.
function useProfileStep({ firstName, reload }: { firstName: string | null; reload: () => Promise<void> }): StepView {
    const t = useTranslations('foreman.intake')
    const tOnboarding = useTranslations('onboarding')
    const handlers = useMemo(
        () => ({
            onDecideIndustry: (input: string) => decideIndustryAction(input),
            onAnalyzeSite: (url: string) => void streamLiveDiscoveries(url).then(ok => track('onboarding_company_analyzed', { ok })),
            onSubmit: async (intake: ForemanIntake) => {
                const industry = intake.industry ?? intake.decidedIndustry
                track('onboarding_website_submitted', industry ? { provided: !!intake.companyUrl, industry } : { provided: !!intake.companyUrl })
                const saved = await saveForemanIntakeAction(intake)
                useForemanStore.getState().setIntakePreview(intakePreviewPlan(saved.industry))
                track('onboarding_step_completed', { step: 'profile' })
                await reload()
            },
        }),
        [reload]
    )
    const intake = useForemanIntake({ firstName, handlers })
    const { step, draft, index, canAdvance, submitting, error, industry, siteRead, platform, set, chooseIndustry, chooseRole, skipWebsite, back, next } = intake
    const skippable = step === 'company' && (!draft.companyUrl.trim() || !!platform)
    const copy = step === 'name' ? { title: tOnboarding('name.title'), description: tOnboarding('name.description') } : { title: t(`steps.${step}.title`), description: t(`steps.${step}.description`) }

    const body = (
        <div className="space-y-2">
            {step === 'company' && <IntakeCompanyStep draft={draft} siteRead={siteRead} platform={platform} disabled={submitting} autoFocus onChange={set} onEnter={next} />}
            {step === 'industry' && <IntakeIndustryStep draft={draft} disabled={submitting} onChange={set} onChoose={chooseIndustry} onEnter={next} />}
            {step === 'role' && <IntakeChoiceStep label={t('role.label')} options={rolesForIndustry(industry)} value={draft.position} placeholder={t('role.placeholder')} disabled={submitting} onChange={position => set({ position })} onChoose={chooseRole} onEnter={next} />}
            {step === 'name' && <IntakeTextStep label={t('name.label')} value={draft.firstName} placeholder={t('name.placeholder')} disabled={submitting} onChange={firstName => set({ firstName })} onEnter={next} />}
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    )

    const footer = (
        <DialogFooter>
            {index === 0 ? (
                <SignOutButton />
            ) : (
                <Button type="button" variant="outline" disabled={submitting} onClick={back}>
                    {tOnboarding('footer.back')}
                </Button>
            )}
            {skippable ? (
                <Button type="button" disabled={submitting} onClick={skipWebsite} data-onboarding="skip">
                    {tOnboarding('footer.skip')}
                </Button>
            ) : (
                <TooltipDisabledReason reason={!submitting && !canAdvance ? t('answerToContinue') : undefined} className="max-sm:*:flex-1">
                    <Button type="button" loading={submitting} disabled={!canAdvance} onClick={next} data-onboarding="continue">
                        {tOnboarding('footer.continue')}
                    </Button>
                </TooltipDisabledReason>
            )}
        </DialogFooter>
    )

    return { key: `profile:${step}`, icon: step === 'company' ? GlobeIcon : LayersIcon, ...copy, body, footer }
}

// Who to invite, sent once the team is built. Skipped with an empty list.
const INVITES_MAX = 10

function useInviteStep({ reload }: { reload: () => Promise<void> }): StepView {
    const t = useTranslations('onboarding')
    const [emails, setEmails] = useState<string[]>([])
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const save = async () => {
        setSaving(true)
        setError(null)
        const result = await saveOnboardingInvitesAction(emails).catch(() => ({ ok: false as const, error: '' }))
        if (!result.ok) {
            setError(t('invite.failed'))
            setSaving(false)
            return
        }
        track('onboarding_step_completed', { step: emails.length ? 'invite' : 'invite_skipped' })
        await reload()
        setSaving(false)
    }

    return {
        key: 'invite',
        icon: UsersIcon,
        title: t('invite.title'),
        description: t('invite.description'),
        body: (
            <div className="space-y-2">
                <InviteEmailsField emails={emails} onChange={setEmails} max={INVITES_MAX} helperText={t('invite.hint', { max: INVITES_MAX })} autoFocus />
                {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
        ),
        footer: (
            <DialogFooter>
                <Button type="button" loading={saving} onClick={() => void save()} data-onboarding={emails.length ? 'continue' : 'skip'}>
                    {emails.length ? t('footer.continue') : t('footer.skip')}
                </Button>
            </DialogFooter>
        ),
    }
}

// Back from a trial checkout closed before the trial started: it opens again from here.
function useTrialStep(): StepView {
    const t = useTranslations('onboarding')
    return {
        key: 'trial',
        icon: CreditCardIcon,
        title: t('trial.title'),
        description: t('trial.description'),
        body: null,
        footer: (
            <DialogFooter>
                <SignOutButton />
                <Button type="button" onClick={() => useBillingStore.getState().openBilling(undefined, ONBOARDING_TRIGGER)} data-onboarding="continue">
                    {t('footer.continue')}
                </Button>
            </DialogFooter>
        ),
    }
}

// An empty pool is asked again this often, and the step moves on by itself once a machine frees up.
const CLAIM_RETRY_MS = 30_000

function useClaimingStep(active: boolean, reload: () => Promise<void>): StepView {
    const t = useTranslations('onboarding')
    const [outcome, setOutcome] = useState<ClaimOutcome | null>(null)
    const [serversOpen, setServersOpen] = useState(false)
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        if (!active) return
        let cancelled = false
        void claimOnboardingEngineAction()
            .catch((): ClaimOutcome => ({ status: 'no_machine' }))
            .then(async result => {
                if (cancelled) return
                setOutcome(result)
                if (result.status === 'claimed' || result.status === 'refused') await reload()
            })
        return () => {
            cancelled = true
        }
    }, [active, attempt, reload])

    useEffect(() => {
        if (!active || outcome?.status !== 'no_machine') return
        const timer = setTimeout(() => setAttempt(count => count + 1), CLAIM_RETRY_MS)
        return () => clearTimeout(timer)
    }, [active, outcome])

    if (outcome?.status === 'no_server') {
        return {
            key: 'claiming:no_server',
            icon: ServerIcon,
            title: t('claiming.title'),
            description: t('claiming.noServer'),
            body: SERVERS_ENABLED ? <ServersDialog open={serversOpen} onOpenChange={setServersOpen} /> : null,
            footer: (
                <DialogFooter>
                    <SignOutButton />
                    {SERVERS_ENABLED && (
                        <Button type="button" variant="outline" onClick={() => setServersOpen(true)}>
                            {t('claiming.openServers')}
                        </Button>
                    )}
                    <Button type="button" onClick={() => setAttempt(count => count + 1)}>
                        {t('installing.retry')}
                    </Button>
                </DialogFooter>
            ),
        }
    }
    if (outcome?.status === 'no_machine') return { key: 'claiming:wait', icon: ClockIcon, title: t('claiming.waitTitle'), description: t('claiming.waitDescription'), body: null }
    return { key: 'claiming', icon: ServerIcon, title: t('claiming.title'), description: t('claiming.description'), body: <Progress size="sm" label={t('claiming.description')} /> }
}

type Install = { status: 'running' } | { status: 'purchase'; slug: string; title: string } | { status: 'failed'; error: string }

function useInstallingStep(active: boolean, reload: () => Promise<void>): StepView {
    const t = useTranslations('onboarding')
    const [install, setInstall] = useState<Install>({ status: 'running' })
    const [attempt, setAttempt] = useState(0)
    const [buying, setBuying] = useState(false)
    const retry = () => {
        setInstall({ status: 'running' })
        setAttempt(count => count + 1)
    }

    useEffect(() => {
        if (!active) return
        let cancelled = false
        void installOnboardingArrivalAction()
            .catch(err => ({ status: 'failed' as const, error: err instanceof Error ? err.message : String(err) }))
            .then(async result => {
                if (cancelled) return
                if (result.status === 'purchase' || result.status === 'failed') return setInstall(result)
                // Installed: the link has done its job, and must not open its card over the board later.
                if (result.status === 'installed') {
                    useOnboardingStore.getState().clearPendingTemplateLink()
                    useOnboardingStore.getState().clearPendingShareLink()
                    track('first_agent_created', { template: 'arrival' })
                }
                await reload()
            })
        return () => {
            cancelled = true
        }
    }, [active, attempt, reload])

    const buy = async (slug: string) => {
        setBuying(true)
        const started = await startTemplateCheckoutAction(slug).catch(() => null)
        if (started?.ok && started.outcome.kind === 'checkout') {
            window.location.href = started.outcome.url
            return
        }
        setBuying(false)
        // Owned or free since: the install goes on.
        if (started?.ok) retry()
        else setInstall({ status: 'failed', error: started?.error ?? '' })
    }

    if (install.status === 'purchase') {
        return {
            key: 'installing:purchase',
            icon: DownloadIcon,
            title: t('installing.purchaseTitle', { title: install.title }),
            description: t('installing.purchaseDescription'),
            body: null,
            footer: (
                <DialogFooter>
                    <SignOutButton />
                    <Button type="button" loading={buying} onClick={() => void buy(install.slug)}>
                        {t('installing.buy')}
                    </Button>
                </DialogFooter>
            ),
        }
    }
    if (install.status === 'failed') {
        return {
            key: 'installing:failed',
            icon: DownloadIcon,
            title: t('installing.title'),
            description: t('installing.failed', { error: install.error }),
            body: null,
            footer: (
                <DialogFooter>
                    <Button type="button" onClick={retry}>
                        {t('installing.retry')}
                    </Button>
                </DialogFooter>
            ),
        }
    }
    return { key: 'installing', icon: DownloadIcon, title: t('installing.title'), description: t('installing.description'), body: <Progress size="sm" label={t('installing.description')} /> }
}

function PhoneBody() {
    return <PhoneVerificationStep active />
}

function WaitlistBody() {
    const t = useTranslations('dialogs.engineWaitlist')
    const { session } = useSession()
    const email = accountLabel(session?.user?.email)
    if (!email) return null
    return <p className="text-sm text-muted-foreground">{t.rich('signedInAs', { email, b: chunks => <span className="font-medium text-foreground">{chunks}</span> })}</p>
}

function LoadFailedFooter({ reload }: { reload: () => Promise<void> }) {
    const t = useTranslations('onboarding')
    const [retrying, setRetrying] = useState(false)
    return (
        <DialogFooter>
            <SignOutButton />
            <Button
                type="button"
                loading={retrying}
                onClick={() => {
                    setRetrying(true)
                    void reload().finally(() => setRetrying(false))
                }}
            >
                {t('loadFailed.retry')}
            </Button>
        </DialogFooter>
    )
}

function useStepView(state: OnboardingState, failed: boolean, reload: () => Promise<void>): StepView {
    const t = useTranslations('onboarding')
    const tWaitlist = useTranslations('dialogs.engineWaitlist')
    const profile = useProfileStep({ firstName: state.firstName, reload })
    const invite = useInviteStep({ reload })
    const trial = useTrialStep()
    const claiming = useClaimingStep(state.step === 'claiming' && !failed, reload)
    const installing = useInstallingStep(state.step === 'installing' && !failed, reload)
    if (failed) return { key: 'failed', icon: LayersIcon, title: t('loadFailed.title'), description: t('loadFailed.description'), body: null, footer: <LoadFailedFooter reload={reload} /> }
    if (state.step === 'profile') return profile
    if (state.step === 'invite') return invite
    if (state.step === 'trial') return trial
    if (state.step === 'claiming') return claiming
    if (state.step === 'installing') return installing
    if (state.step === 'phone') return { key: 'phone', icon: PhoneIcon, title: t('phone.title'), description: t('phone.description'), body: <PhoneBody /> }
    return {
        key: 'waitlist',
        icon: ClockIcon,
        title: tWaitlist('title'),
        description: tWaitlist('subtitle'),
        body: <WaitlistBody />,
        footer: (
            <DialogFooter>
                <SignOutButton />
            </DialogFooter>
        ),
    }
}

// What each step that shows is counted as, once per step.
function useStepViewed(key: string, state: OnboardingState) {
    const seen = useRef(new Set<string>())
    useEffect(() => {
        if (seen.current.has(key)) return
        if (seen.current.size === 0 && (state.step === 'profile' || state.arrival)) track('onboarding_started', { mode: 'foreman', arrival: state.arrival?.kind ?? 'none' })
        seen.current.add(key)
        track('onboarding_step_viewed', { step: key.replace(':', '_') })
    }, [key, state.step, state.arrival])
}

/**
 * The onboarding of a new workspace, over its board: one surface that keeps its place from one step
 * to the next and takes the height of each (StepSwap), no progress to count down. It cannot be
 * closed: each step closes itself, and the step after it is read again from the server.
 */
export function OnboardingDialog({ state, failed, reload }: { state: OnboardingState; failed: boolean; reload: () => Promise<void> }) {
    const view = useStepView(state, failed, reload)
    useStepViewed(view.key, state)

    return (
        <Dialog open dismissible={false}>
            <DialogContent
                className="gap-0 overflow-hidden p-0 sm:max-w-md"
                showCloseButton={false}
                onEscapeKeyDown={event => event.preventDefault()}
                onPointerDownOutside={event => event.preventDefault()}
                onInteractOutside={event => event.preventDefault()}
            >
                <StepSwap stepKey={view.key}>
                    {/* The frame of a padded dialog, inside the surface that resizes: the header bleeds to its edges, only the body scrolls. */}
                    <div data-slot="dialog-content" className="flex max-h-[min(44rem,calc(100dvh-3rem))] flex-col gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm">
                        <DialogHeaderBar icon={view.icon} title={view.title} description={view.description} />
                        {view.body && <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">{view.body}</div>}
                        {view.footer}
                    </div>
                </StepSwap>
            </DialogContent>
        </Dialog>
    )
}
