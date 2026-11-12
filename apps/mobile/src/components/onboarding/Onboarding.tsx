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
import { PaywallCard } from '@/components/billing/PaywallCard'
import { track } from '@/lib/analytics'
import { usePaywall } from '@/store/usePaywall'
import { spacing } from '@/theme/tokens'

import { IntakeView } from './IntakeView'
import { OnboardingConversation } from './OnboardingConversation'
import { pendingWidget, readBuildResult, widgetOf } from './parts'
import { useIntake } from './useIntake'
import { useOnboardingChat } from './useOnboardingChat'
import type { TeamStartState } from './widgets/TeamCards'

export type LeadStarted = { agentId: string; conversationId: string }

// The onboarding of a new workspace, the web's walked in the app: the welcome card, then the hub's
// conversation from the starter team to the built team. The confirmed plan puts the store's offer up,
// and the build follows on its own once the subscription is on.
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

    // The trial card is the store's offer: it answers itself the moment the hub confirms the purchase,
    // and stays up through a closed sheet or a failed payment. A hub that sells nothing through the
    // store (self-hosted, or before the store is set up) starts the workspace without a card instead.
    const trialCall = pendingWidget(messages)?.widget === 'open_checkout' ? pendingWidget(messages)?.toolCallId : null
    const { answer } = chat
    const paywall = usePaywall({
        surface: 'onboarding',
        enabled: Boolean(trialCall),
        onEntitled: () => {
            if (!trialCall) return
            track('onboarding_checkout_answered', { ok: true })
            answer(trialCall, { ok: true, status: 'entitled' })
        },
    })
    const unavailable = paywall.state.step === 'unavailable' ? paywall.state.reason : null
    const cardless = unavailable === 'not_sold'
    // Already on (a plan from the web, the other store, a sandbox): there is nothing to buy.
    const alreadyOn = unavailable === 'subscribed' || unavailable === 'billed_on_web' || unavailable === 'other_store' || unavailable === 'sandbox' || unavailable === 'lifetime_plan'
    useEffect(() => {
        if (!trialCall || !alreadyOn) return
        track('onboarding_checkout_answered', { ok: true })
        answer(trialCall, { ok: true, status: 'entitled' })
    }, [trialCall, alreadyOn, answer])
    useEffect(() => {
        if (!trialCall || !caller || !cardless || teamStart !== 'starting') return
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
    }, [trialCall, caller, cardless, teamStart, answer])

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

    return <OnboardingConversation messages={messages} busy={busy} failed={Boolean(chat.error)} onRetry={() => void chat.regenerate()} teamStart={teamStart} paywall={cardless || alreadyOn ? undefined : <PaywallCard state={paywall.state} provider={paywall.provider} onBuy={paywall.buy} onRestore={paywall.restore} onRetry={paywall.retry} />} leadStarting={leadStarting} onAnswer={chat.answer} onSend={text => void chat.send(text)} onStop={chat.stop} onRetryStart={() => setTeamStart('starting')} onRetryBuild={() => void chat.kickoff()} onStartLead={() => void startTheLead()} />
}
