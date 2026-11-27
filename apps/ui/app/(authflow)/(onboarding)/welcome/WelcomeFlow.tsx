'use client'

import { claimWelcomeEngineAction, finishWelcomeAction, welcomeEngineAnswersAction } from '@/app/api/_actions/welcome-engine.actions'
import { finishWelcomeTeamAction, saveWelcomeSectorAction, saveWelcomeViewAction } from '@/app/api/_actions/welcome.actions'
import { OnboardingPage } from '@/components/onboarding/OnboardingPage'
import { LazyMembersPanel, LazyProofPanel, LazyShowcase, LazyTeamPanel, LazyViewPanel } from '@/components/onboarding/panels/LazyPanels'
import { WelcomeWorkspaceSwitcher } from '@/components/onboarding/WelcomeWorkspaceSwitcher'
import { EngineWaitlistDialog } from '@/components/dialogs/EngineWaitlistDialog'
import { EngineStep, type EngineProgress } from '@/components/onboarding/welcome/EngineStep'
import { SectorStep, type SectorAnswer } from '@/components/onboarding/welcome/SectorStep'
import { TeamStep, type SentInvite } from '@/components/onboarding/welcome/TeamStep'
import { ViewStep } from '@/components/onboarding/welcome/ViewStep'
import { useErrorText } from '@/hooks/useErrorText'
import { accountLabel } from '@/lib/auth/placeholder-email'
import type { ActionFailure } from '@/lib/i18n/action-error'
import { sectorById, type SectorId } from '@/lib/onboarding/sectors'
import type { StarterRole } from '@/lib/onboarding/starter-roles.server'
import { ONBOARDING_STEPS, type OnboardingStep } from '@/lib/onboarding/step'
import { rememberWorkspaceView, type WorkspaceView } from '@/lib/workspace-view'
import { track } from '@rerun/analytics/client'
import { isSubscriptionEntitled } from '@rerun/cloud/billing'
import { OnboardingTrialStep } from '@rerun/cloud/billing.client'
import type { TemplateCategory } from '@rerun/contracts'
import { PhoneStep } from '@/components/onboarding/welcome/PhoneStep'
import { useSession } from '@/supabase/session/SessionProvider'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

export type WelcomeAnswers = {
    sector: SectorId | null
    sectorLabel: string
    industry: TemplateCategory | null
    view: WorkspaceView
    invites: SentInvite[]
}

type QuestionStep = 'industry' | 'team' | 'view'

const QUESTIONS: QuestionStep[] = ['industry', 'team', 'view']

// How long the machine gets to answer before the page offers to try again or go in anyway.
const ENGINE_PATIENCE_MS = 90_000
const ENGINE_POLL_MS = 2_000

// The three questions, one at a time in the onboarding page: each answer is saved as it is given and
// moves to the next. A number still owed after a Google sign-up is asked first. Then the trial, paid
// for in the page with the billing dialog's checkout, and the machine, whose milestones the Chief of
// Staff's orb reads out before it hands them over to the app. `afterQuestions` is the step the server
// resolved for the end of the questions: the trial, or the machine where the workspace is already
// entitled or nothing is sold. With no machine left in the pool, the waitlist wall opens over the
// trial.
export function WelcomeFlow({ initialStep, afterQuestions, initial, starterRoles, firstName, next, phonePending, waitlisted, canSwitchWorkspace }: { initialStep: OnboardingStep; afterQuestions: OnboardingStep; initial: WelcomeAnswers; starterRoles: Record<string, StarterRole>; firstName: string | null; next: string; phonePending: boolean; waitlisted: boolean; canSwitchWorkspace: boolean }) {
    const errorText = useErrorText()
    const router = useRouter()
    const { phoneStep, session, workspace } = useSession()
    const askPhone = phonePending && phoneStep !== 'clear'
    const entitled = isSubscriptionEntitled(workspace?.subscription_status)
    const [step, setStep] = useState<OnboardingStep>(initialStep)
    const [direction, setDirection] = useState(1)
    const [sector, setSector] = useState<SectorAnswer>({ sector: initial.sector, label: initial.sectorLabel })
    // The industry an answer was filed under, with the words it was decided for.
    const [filed, setFiled] = useState<{ label: string; industry: TemplateCategory | null }>({ label: initial.sectorLabel, industry: initial.industry })
    const [view, setView] = useState<WorkspaceView>(initial.view)
    const [invites, setInvites] = useState<SentInvite[]>(initial.invites)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const viewed = useRef<OnboardingStep | null>(null)
    useEffect(() => {
        if (viewed.current === step) return
        viewed.current = step
        track('onboarding_step_viewed', { step })
    }, [step])

    const go = (target: OnboardingStep) => {
        setError(null)
        setDirection(ONBOARDING_STEPS.indexOf(target) < ONBOARDING_STEPS.indexOf(step) ? -1 : 1)
        setStep(target)
    }

    const saved = (result: { ok: true } | ActionFailure, completed: QuestionStep, target: OnboardingStep, skipped = false, chosenView?: WorkspaceView) => {
        setSaving(false)
        if (!result.ok) {
            setError(errorText(result))
            return
        }
        track('onboarding_step_completed', { step: completed, skipped, ...(chosenView ? { view: chosenView } : {}) })
        go(target)
    }

    const submitSector = async () => {
        setSaving(true)
        setError(null)
        const result = await saveWelcomeSectorAction(sector.sector ? { sector: sector.sector } : { label: sector.label })
        if (result.ok) setFiled({ label: sector.sector ? '' : sector.label, industry: result.industry })
        saved(result, 'industry', 'team')
    }

    const finishTeam = async () => {
        setSaving(true)
        setError(null)
        saved(await finishWelcomeTeamAction(), 'team', 'view', invites.length === 0)
    }

    // Kept on this device as the view the app opens in once the onboarding is done.
    const submitView = async () => {
        setSaving(true)
        setError(null)
        rememberWorkspaceView(view)
        saved(await saveWelcomeViewAction(view), 'view', afterQuestions, false, view)
    }

    // The webhook writes the trial onto the workspace, which the session follows in realtime: the
    // machine starts.
    useEffect(() => {
        if (step !== 'trial' || !entitled) return
        track('onboarding_step_completed', { step: 'trial' })
        setError(null)
        setDirection(1)
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
    const content = askPhone ? (
        <PhoneStep />
    ) : step === 'industry' ? (
        <SectorStep answer={sector} onChange={setSector} onSubmit={() => void submitSector()} saving={saving} error={error} />
    ) : step === 'team' ? (
        <TeamStep invites={invites} onInvited={sent => setInvites(current => [...current, sent])} onDone={() => void finishTeam()} onBack={back} saving={saving} error={error} />
    ) : step === 'view' ? (
        <ViewStep view={view} onView={setView} onSubmit={() => void submitView()} onBack={back} saving={saving} error={error} />
    ) : step === 'trial' ? (
        <OnboardingTrialStep onBack={() => go('view')} waitlisted={waitlisted} />
    ) : (
        <EngineStep firstName={firstName} progress={engine} error={error} onRetry={() => void startEngine()} onEnter={() => void enter()} entering={entering} />
    )

    const t = useTranslations('onboarding.sectors')
    const picked = sectorById(sector.sector)
    const email = accountLabel(session?.user?.email)
    const panel =
        !askPhone && step === 'industry' ? (
            <LazyTeamPanel industry={picked?.category ?? (sector.label === filed.label ? filed.industry : null)} sector={sector.sector} label={picked ? t(`${picked.id}.label`) : sector.label} roles={starterRoles} />
        ) : !askPhone && step === 'team' ? (
            <LazyMembersPanel name={firstName ?? email ?? ''} email={email} invites={invites.map(invite => invite.email)} />
        ) : !askPhone && step === 'view' ? (
            <LazyViewPanel view={view} onView={setView} person={firstName ?? email ?? ''} />
        ) : !askPhone && step === 'trial' ? (
            <LazyProofPanel />
        ) : (
            <LazyShowcase />
        )

    const question = QUESTIONS.indexOf(step as QuestionStep)
    const waitlistUp = waitlisted && (step === 'trial' || step === 'engine')
    // Someone who created this workspace by mistake goes back to the one they were in, from any step.
    const switcher = canSwitchWorkspace ? <WelcomeWorkspaceSwitcher /> : undefined

    return (
        <>
            <OnboardingPage stepKey={askPhone ? 'phone' : step} direction={direction} corner={switcher} hideLogo={step === 'engine' && !askPhone} progress={askPhone || question === -1 ? undefined : { index: question, count: QUESTIONS.length }} panel={panel}>
                {content}
            </OnboardingPage>
            <EngineWaitlistDialog open={waitlistUp} corner={switcher} />
        </>
    )
}
