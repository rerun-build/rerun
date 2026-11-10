import type { ForemanStateResponse } from '@rerun/contracts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { ApiError } from '@/api/client'
import { decideIndustry, saveIntake, startLead, startTeam } from '@/api/onboarding'
import { useAuth } from '@/auth/AuthProvider'
import { ConversationSkeleton } from '@/components/chat/ConversationSkeleton'
import { AppText } from '@/components/ui/AppText'
import { PillButton } from '@/components/ui/PillButton'
import { track } from '@/lib/analytics'
import { spacing } from '@/theme/tokens'

import { IntakeView } from './IntakeView'
import { OnboardingConversation } from './OnboardingConversation'
import { pendingWidget, readBuildResult, widgetOf } from './parts'
import { useIntake } from './useIntake'
import { useOnboardingChat } from './useOnboardingChat'
import type { TeamStartState } from './widgets/TeamCards'

export type LeadStarted = { agentId: string; conversationId: string }

// The onboarding of a new workspace, the web's walked in the app: the welcome card, then the hub's
// conversation from the starter team to the built team. Nothing is sold here: the confirmed plan starts
// the workspace without a card, and the build follows on its own.
export function Onboarding({ state, onLeadStarted }: { state: ForemanStateResponse; onLeadStarted: (lead: LeadStarted) => void }) {
    const { session, me } = useAuth()
    const caller = useMemo(() => (session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null), [session, me])
    const [welcomed, setWelcomed] = useState(state.phase !== 'discover')
    const chat = useOnboardingChat(caller)
    const [teamStart, setTeamStart] = useState<TeamStartState>('starting')
    const [leadStarting, setLeadStarting] = useState(false)
    const t = useTranslations('mobileOnboarding')

    const phase = state.phase
    useEffect(() => {
        if (phase === 'discover') track('onboarding_started', { mode: 'foreman', arrival: 'none' })
        track('onboarding_step_viewed', { step: phase })
    }, [phase])

    const intake = useIntake({
        knownFirstName: state.firstName || null,
        decideIndustry: input => (caller ? decideIndustry(caller, input) : Promise.resolve(null)),
        submit: async answers => {
            if (!caller) throw new Error('Signed out')
            await saveIntake(caller, answers)
            track('onboarding_step_completed', { step: 'discover' })
            setWelcomed(true)
            void chat.kickoff()
        },
    })

    // A conversation reopened on a step the hub runs itself is sent once, as the web's kickoff does:
    // it puts the trial card back up, or builds.
    const opened = useRef(false)
    const { history, messages, busy, kickoff } = chat
    useEffect(() => {
        if (!welcomed || history !== 'ready' || busy || opened.current) return
        opened.current = true
        const asked = messages.some(message => message.parts.some(part => widgetOf(part)?.widget === (state.phase === 'build' ? 'build_team' : 'open_checkout')))
        if (messages.length === 0 || ((state.phase === 'trial' || state.phase === 'build') && !asked)) void kickoff()
    }, [welcomed, history, busy, messages, state.phase, kickoff])

    // The trial card answers itself: the workspace starts without a card the moment the plan is confirmed.
    const trialCall = pendingWidget(messages)?.widget === 'open_checkout' ? pendingWidget(messages)?.toolCallId : null
    const { answer } = chat
    useEffect(() => {
        if (!trialCall || !caller || teamStart !== 'starting') return
        let cancelled = false
        startTeam(caller)
            .then(entitled => {
                if (cancelled) return
                track('onboarding_checkout_answered', entitled ? { ok: true } : { ok: false, reason: 'trial_refused' })
                answer(trialCall, entitled ? { ok: true, status: 'entitled' } : { ok: false, reason: 'trial_refused' })
            })
            .catch(error => {
                if (cancelled) return
                console.warn('[onboarding] starting the workspace failed', error instanceof ApiError ? error.message : error)
                setTeamStart('failed')
            })
        return () => {
            cancelled = true
        }
    }, [trialCall, caller, teamStart, answer])

    const built = messages.flatMap(message => message.parts.flatMap(part => (widgetOf(part)?.widget === 'build_team' ? [readBuildResult(widgetOf(part)?.output)] : []))).find(Boolean) ?? null
    const lead = built?.lead ?? null
    const reported = useRef(false)
    useEffect(() => {
        if (!built || reported.current) return
        reported.current = true
        track('onboarding_team_built', { agents: built.agents, failed: built.failed.length, error: false })
    }, [built])
    const startTheLead = async () => {
        if (!caller || !lead) return
        setLeadStarting(true)
        try {
            const started = await startLead(caller, lead.agentId)
            onLeadStarted({ agentId: lead.agentId, conversationId: started.conversationId })
        } catch (error) {
            console.warn('[onboarding] starting the first coworker failed', error)
            setLeadStarting(false)
        }
    }

    if (!welcomed) return <IntakeView intake={intake} />

    if (history === 'loading')
        return (
            <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: spacing.xl - 4, paddingBottom: spacing.xxl }}>
                <ConversationSkeleton />
            </View>
        )

    if (history === 'error')
        return (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
                <AppText variant="callout" tone="muted">
                    {t('setup.loadFailed')}
                </AppText>
                <PillButton label={t('setup.retry')} variant="secondary" onPress={chat.load} />
            </View>
        )

    return <OnboardingConversation messages={messages} busy={busy} failed={Boolean(chat.error)} onRetry={() => void chat.regenerate()} teamStart={teamStart} leadStarting={leadStarting} onAnswer={chat.answer} onSend={text => void chat.send(text)} onStop={chat.stop} onRetryStart={() => setTeamStart('starting')} onRetryBuild={() => void chat.kickoff()} onStartLead={() => void startTheLead()} />
}
