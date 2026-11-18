import type { OnboardingState } from '@rerun/contracts'
import { useEffect, useMemo, useState } from 'react'

import { claimEngine, decideIndustry, engineAnswers, finishOnboarding, saveIntake, startWorkspace } from '@/api/onboarding'
import { useAuth } from '@/auth/AuthProvider'
import { track } from '@/lib/analytics'

import { IntakeView } from './IntakeView'
import { SetupNotice, type SetupState } from './notices'
import { useIntake } from './useIntake'
import { setUpWorkspace } from './workspace-setup'

// The onboarding of a new workspace, the welcome page's walked in the app: its questions, then the
// workspace and its machine are started and the Chief of Staff takes over. Nothing is sold here: the
// workspace starts without a card. `onRefused`: the hub turned the start away, where it stands is read again.
export function Onboarding({ state, onDone, onRefused }: { state: OnboardingState; onDone: () => void; onRefused: () => void }) {
    const { session, me } = useAuth()
    const caller = useMemo(() => (session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null), [session, me])
    const [answered, setAnswered] = useState(state.stage === 'setup')
    const [setup, setSetup] = useState<SetupState>('starting')
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        track('onboarding_step_viewed', { step: answered ? 'engine' : 'site' })
    }, [answered])

    const intake = useIntake({
        knownFirstName: state.firstName || null,
        decideIndustry: input => (caller ? decideIndustry(caller, input) : Promise.resolve(null)),
        submit: async answers => {
            if (!caller) throw new Error('Signed out')
            await saveIntake(caller, answers)
            track('onboarding_step_completed', { step: 'role' })
            setAnswered(true)
        },
    })

    useEffect(() => {
        if (!answered || !caller || setup !== 'starting') return
        let live = true
        const steps = { startWorkspace: () => startWorkspace(caller), claimEngine: () => claimEngine(caller), engineAnswers: () => engineAnswers(caller), finish: () => finishOnboarding(caller) }
        void setUpWorkspace(steps, () => live).then(outcome => {
            if (!live || outcome === 'left') return
            if (outcome === 'ready') {
                track('onboarding_completed', { engine: true })
                return onDone()
            }
            if (outcome === 'refused') onRefused()
            setSetup(outcome === 'blocked' ? 'blocked' : 'failed')
        })
        return () => {
            live = false
        }
        // A refreshed token is not a new start: only a retry runs it again.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [answered, Boolean(caller), attempt])

    if (!answered) return <IntakeView intake={intake} />

    return (
        <SetupNotice
            state={setup}
            onRetry={() => {
                setSetup('starting')
                setAttempt(current => current + 1)
            }}
        />
    )
}
