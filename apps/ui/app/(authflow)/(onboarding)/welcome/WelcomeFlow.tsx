'use client'

import { claimWelcomeEngineAction, finishWelcomeAction, welcomeEngineAnswersAction } from '@/app/api/_actions/welcome-engine.actions'
import { finishWelcomeTeamAction, saveWelcomeIndustryAction, saveWelcomeRoleAction, saveWelcomeSiteAction, saveWelcomeViewAction } from '@/app/api/_actions/welcome.actions'
import { streamLiveDiscoveries } from '@/components/builder/discoveries/useCompanyDiscoveries'
import { OnboardingDialog } from '@/components/onboarding/OnboardingDialog'
import { WelcomeWorkspaceSwitcher } from '@/components/onboarding/WelcomeWorkspaceSwitcher'
import { EngineWaitlistDialog } from '@/components/dialogs/EngineWaitlistDialog'
import { EngineStep, type EngineProgress } from '@/components/onboarding/welcome/EngineStep'
import { IndustryStep, type IndustryAnswer } from '@/components/onboarding/welcome/IndustryStep'
import { RoleStep, type RoleAnswer } from '@/components/onboarding/welcome/RoleStep'
import { SiteStep } from '@/components/onboarding/welcome/SiteStep'
import { TeamStep, type SentInvite } from '@/components/onboarding/welcome/TeamStep'
import { TrialStep } from '@/components/onboarding/welcome/TrialStep'
import { ViewStep } from '@/components/onboarding/welcome/ViewStep'
import { useErrorText } from '@/hooks/useErrorText'
import type { ActionFailure } from '@/lib/i18n/action-error'
import { rolesForIndustry } from '@/lib/onboarding/intake'
import type { OnboardingStep } from '@/lib/onboarding/step'
import { rememberWorkspaceView, type WorkspaceView } from '@/lib/workspace-view'
import { useBillingStore } from '@/stores/billing.store'
import { track } from '@rerun/analytics/client'
import { isSubscriptionEntitled } from '@rerun/cloud/billing'
import type { TemplateCategory } from '@rerun/contracts'
import { PhoneStep } from '@/components/onboarding/welcome/PhoneStep'
import { useSession } from '@/supabase/session/SessionProvider'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

export type WelcomeAnswers = {
    site: string
    siteIndustry: TemplateCategory | null
    industry: TemplateCategory | null
    industryLabel: string
    role: string
    invites: SentInvite[]
}

type QuestionStep = 'site' | 'industry' | 'role' | 'team' | 'view'

const QUESTIONS: QuestionStep[] = ['site', 'industry', 'role', 'team', 'view']

// How long a picked tile shows its check before the next step takes its place.
const PICKED_BEAT_MS = 250

// How long the machine gets to answer before the page offers to try again or go in anyway.
const ENGINE_PATIENCE_MS = 90_000
const ENGINE_POLL_MS = 2_000

// The five questions, one at a time in the onboarding dialog: each answer is saved as it is given and
// moves to the next. A number still owed after a Google sign-up is asked first. Then the trial,
// through today's checkout, and the machine, whose milestones the Chief of Staff's orb reads out
// before it hands them over to the app. `afterQuestions` is the step the server resolved for the end
// of the questions: the trial, or the machine where the workspace is already entitled or nothing is
// sold. With no machine left in the pool, the waitlist wall stands before the trial. The billing
// dialog and the waitlist wall each take the onboarding dialog's place, never open on top of it.
export function WelcomeFlow({ initialStep, afterQuestions, initial, firstName, next, phonePending, waitlisted, canSwitchWorkspace }: { initialStep: OnboardingStep; afterQuestions: OnboardingStep; initial: WelcomeAnswers; firstName: string | null; next: string; phonePending: boolean; waitlisted: boolean; canSwitchWorkspace: boolean }) {
    const errorText = useErrorText()
    const router = useRouter()
    const { phoneStep, workspace } = useSession()
    const askPhone = phonePending && phoneStep !== 'clear'
    const entitled = isSubscriptionEntitled(workspace?.subscription_status)
    const [step, setStep] = useState<OnboardingStep>(initialStep)
    const [site, setSite] = useState(initial.site)
    const [guess, setGuess] = useState<TemplateCategory | null>(initial.siteIndustry)
    const [industry, setIndustry] = useState<IndustryAnswer>({ industry: initial.industry ?? initial.siteIndustry, label: initial.industryLabel, other: !!initial.industryLabel })
    const [role, setRole] = useState<RoleAnswer>({ role: initial.role, other: !!initial.role && !rolesForIndustry(initial.industry).includes(initial.role) })
    const [invites, setInvites] = useState<SentInvite[]>(initial.invites)
    const [saving, setSaving] = useState<'site' | 'skip' | 'answer' | null>(null)
    const [error, setError] = useState<string | null>(null)

    const viewed = useRef<OnboardingStep | null>(null)
    useEffect(() => {
        if (viewed.current === step) return
        viewed.current = step
        track('onboarding_step_viewed', { step })
    }, [step])

    // Started while the site is still being typed: it fills the profile cache the answer reads when sent.
    const read = useCallback((typed: string) => void streamLiveDiscoveries(typed), [])

    const go = (target: OnboardingStep) => {
        setError(null)
        setStep(target)
    }

    const saved = (result: { ok: true } | ActionFailure, completed: QuestionStep, target: OnboardingStep, skipped = false, view?: WorkspaceView) => {
        setSaving(null)
        if (!result.ok) {
            setError(errorText(result))
            return false
        }
        track('onboarding_step_completed', { step: completed, skipped, ...(view ? { view } : {}) })
        go(target)
        return true
    }

    const submitSite = async (value: string | null) => {
        setSaving(value === null ? 'skip' : 'site')
        setError(null)
        const result = await saveWelcomeSiteAction(value)
        if (result.ok && result.industry) {
            setGuess(result.industry)
            if (!industry.industry && !industry.other) setIndustry({ industry: result.industry, label: '', other: false })
        }
        if (value === null) {
            setSite('')
            setGuess(null)
        }
        saved(result, 'site', 'industry', value === null)
    }

    const submitIndustry = async () => {
        setSaving('answer')
        setError(null)
        const result = await saveWelcomeIndustryAction(industry.other ? { label: industry.label } : { industry: industry.industry ?? 'other' })
        if (result.ok) setIndustry(current => (current.other ? current : { ...current, industry: result.industry }))
        if (result.ok && industry.other) setGuess(result.industry)
        saved(result, 'industry', 'role')
    }

    const submitRole = async () => {
        setSaving('answer')
        setError(null)
        saved(await saveWelcomeRoleAction(role.role), 'role', 'team')
    }

    const finishTeam = async () => {
        setSaving('answer')
        setError(null)
        saved(await finishWelcomeTeamAction(), 'team', 'view', invites.length === 0)
    }

    // Kept on this device as the view the app opens in once the onboarding is done.
    const pickView = async (view: WorkspaceView) => {
        setError(null)
        rememberWorkspaceView(view)
        const [result] = await Promise.all([saveWelcomeViewAction(view), new Promise(resolve => setTimeout(resolve, PICKED_BEAT_MS))])
        return saved(result, 'view', afterQuestions, false, view)
    }

    const billingOpen = useBillingStore(state => state.open)
    const startTrial = useCallback(() => {
        track('checkout_started', { plan: 'base', source: 'onboarding' })
        useBillingStore.getState().openBilling(undefined, 'onboarding')
    }, [])

    // Once on arrival at the trial: a checkout they closed stays closed until they ask for it again.
    useEffect(() => {
        if (step === 'trial' && !waitlisted && !entitled) startTrial()
    }, [step, waitlisted, entitled, startTrial])

    // The webhook writes the trial onto the workspace, which the session follows in realtime: the
    // dialog over the page is closed for them and the machine starts.
    useEffect(() => {
        if (step !== 'trial' || !entitled) return
        useBillingStore.getState().setOpen(false)
        track('onboarding_step_completed', { step: 'trial' })
        setError(null)
        setStep('engine')
    }, [step, entitled])

    const [engine, setEngine] = useState<EngineProgress>({ done: [], ready: false, failed: false })
    const [entering, setEntering] = useState(false)
    const attempt = useRef(0)
    const startEngine = useCallback(async () => {
        const token = (attempt.current += 1)
        const live = () => attempt.current === token
        setEngine({ done: ['trial'], ready: false, failed: false })
        const claim = await claimWelcomeEngineAction().catch(() => null)
        if (!live()) return
        if (!claim?.ok) {
            setError(claim ? errorText(claim) : null)
            setEngine({ done: ['trial'], ready: false, failed: true })
            return
        }
        setEngine({ done: ['trial', 'machine'], ready: false, failed: false })
        const deadline = Date.now() + ENGINE_PATIENCE_MS
        while (live() && !(await welcomeEngineAnswersAction().catch(() => false))) {
            if (Date.now() > deadline) return setEngine({ done: ['trial', 'machine'], ready: false, failed: true })
            await new Promise(resolve => setTimeout(resolve, ENGINE_POLL_MS))
        }
        if (!live()) return
        const finished = await finishWelcomeAction().catch(() => null)
        if (!live()) return
        if (!finished?.ok) {
            setError(finished ? errorText(finished) : null)
            return setEngine({ done: ['trial', 'machine', 'engine'], ready: false, failed: true })
        }
        setEngine({ done: ['trial', 'machine', 'engine'], ready: true, failed: false })
    }, [errorText])

    useEffect(() => {
        if (step !== 'engine' || waitlisted) return
        setError(null)
        void startEngine()
        return () => {
            attempt.current += 1
        }
    }, [step, waitlisted, startEngine])

    const enter = async () => {
        setEntering(true)
        if (!engine.ready) {
            const finished = await finishWelcomeAction().catch(() => null)
            if (!finished?.ok) {
                setEntering(false)
                return setError(finished ? errorText(finished) : null)
            }
        }
        track('onboarding_completed', { engine: engine.ready })
        router.replace(next)
        router.refresh()
    }

    const back = () => go(QUESTIONS[Math.max(0, QUESTIONS.indexOf(step as QuestionStep) - 1)])
    const answering = saving === 'answer'

    const content = askPhone ? (
        <PhoneStep />
    ) : step === 'site' ? (
        <SiteStep firstName={firstName} value={site} onChange={setSite} onRead={read} onSubmit={() => void submitSite(site.trim())} onSkip={() => void submitSite(null)} saving={saving === 'site' || saving === 'skip' ? saving : null} error={error} />
    ) : step === 'industry' ? (
        <IndustryStep answer={industry} onChange={setIndustry} onSubmit={() => void submitIndustry()} onBack={back} saving={answering} error={error} />
    ) : step === 'role' ? (
        <RoleStep industry={industry.other ? guess : industry.industry} answer={role} onChange={setRole} onSubmit={() => void submitRole()} onBack={back} saving={answering} error={error} />
    ) : step === 'team' ? (
        <TeamStep invites={invites} onInvited={sent => setInvites(current => [...current, sent])} onDone={() => void finishTeam()} onBack={back} saving={answering} error={error} />
    ) : step === 'view' ? (
        <ViewStep onPick={pickView} onBack={back} error={error} />
    ) : step === 'trial' ? (
        <TrialStep onBack={() => go('view')} onStart={startTrial} />
    ) : (
        <EngineStep firstName={firstName} progress={engine} error={error} onRetry={() => void startEngine()} onEnter={() => void enter()} entering={entering} />
    )

    const waitlistUp = waitlisted && (step === 'trial' || step === 'engine')
    // Someone who created this workspace by mistake goes back to the one they were in, from any step.
    const switcher = canSwitchWorkspace ? <WelcomeWorkspaceSwitcher /> : undefined

    return (
        <>
            <OnboardingDialog open={!waitlistUp && !(step === 'trial' && billingOpen)} stepKey={askPhone ? 'phone' : step} corner={switcher}>
                {content}
            </OnboardingDialog>
            <EngineWaitlistDialog open={waitlistUp} corner={switcher} />
        </>
    )
}
