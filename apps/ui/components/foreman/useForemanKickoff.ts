'use client'

import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { track } from '@moldwright/analytics/client'

import { saveForemanIntakeAction, waiveForemanProfileAction } from '@/app/api/_actions/foreman-intake.actions'
import { readArrivingIntent } from '@/lib/foreman/arriving-intent'
import { buildKickoffMarker, buildOwnKickoff, encodeIntent, type KickoffIntent } from '@/lib/foreman/kickoff-marker'
import { type ForemanArrival, type ForemanPhase } from '@/lib/foreman/phase'
import type { ForemanSurface } from '@/lib/foreman/surface'
import { arrivalPreviewPlan, boxesOfIntake, intakePreviewPlan } from '@/lib/onboarding/intake'
import { useForemanStore } from '@/stores/foreman.store'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'

type ForemanStateAnswer = { phase: ForemanPhase; firstName?: string; arrival?: ForemanArrival | null; surface: ForemanSurface }

async function fetchForemanState(query = ''): Promise<ForemanStateAnswer | null> {
    const res = await fetch(`/api/chat/foreman/state${query}`)
    return res.ok ? ((await res.json()) as ForemanStateAnswer) : null
}

export async function refreshForemanSurface(): Promise<void> {
    const state = await fetchForemanState().catch(() => null)
    if (!state) return
    useForemanStore.getState().setSurface(state.surface)
    if (state.phase === 'companion') useForemanStore.getState().setFunnel('companion')
}

async function skipOwedWelcomeCard(): Promise<void> {
    await waiveForemanProfileAction().catch(() => {})
    const store = useForemanStore.getState()
    store.setArrival(null)
    store.setFunnel('companion')
    await refreshForemanSurface()
}

export async function settleBuiltFunnel(): Promise<'skipped' | 'companion'> {
    const state = await fetchForemanState().catch(() => null)
    const store = useForemanStore.getState()
    if (state) store.setSurface(state.surface)
    if (state?.phase === 'discover') {
        await skipOwedWelcomeCard()
        return 'skipped'
    }
    store.setArrival(null)
    store.setFunnel('companion')
    return 'companion'
}

export function useForemanKickoff({ send, messageCount, restoreDone }: { send: (text: string) => void; messageCount: number; restoreDone: boolean }) {
    const { workspace, isAnonymous, phoneStep } = useSession()
    const searchParams = useSearchParams()
    const funnel = useForemanStore(state => state.funnel)
    const intake = useForemanStore(state => state.intake)
    const [firstName, setFirstName] = useState<string | null>(null)
    const arrival = useForemanStore(state => state.arrival)
    const identity = workspace ? `${workspace.id}:${isAnonymous ? 'anonymous' : 'account'}` : null
    const asked = useRef<string | null>(null)
    const [settled, setSettled] = useState<string | null>(null)
    const greeted = useRef(false)
    const intent = useRef<KickoffIntent | null>(null)
    const [prompted, setPrompted] = useState(false)
    const parkedOwnAsk = useRef<string | null>(null)

    useEffect(() => {
        if (!identity || asked.current === identity) return
        asked.current = identity

        intent.current = readArrivingIntent(searchParams, useOnboardingStore.getState())
        setPrompted(intent.current?.kind === 'prompt')
        const query = intent.current ? `?intent=${encodeURIComponent(encodeIntent(intent.current))}` : ''

        void fetchForemanState(query)
            .then(async state => {
                const store = useForemanStore.getState()
                if (state) store.setSurface(state.surface)
                const onboarding = useOnboardingStore.getState()
                const parked = onboarding.pendingIntake
                if (!state || state.phase === 'companion') {
                    if (!isAnonymous) onboarding.clearPendingIntake()
                    store.setArrival(null)
                    store.setFunnel('companion')
                    return
                }
                setFirstName(state.firstName?.trim() || null)
                store.setArrival(state.arrival ?? null)
                if (state.arrival && !state.arrival.installed && state.phase !== 'discover') store.setIntakePreview(arrivalPreviewPlan(state.arrival.coworker ?? state.arrival.title))

                if (state.phase === 'waitlist') {
                    if (parked && !isAnonymous) {
                        await saveForemanIntakeAction(parked).catch(() => {})
                        onboarding.clearPendingIntake()
                    }
                    store.setWaitlisted(true)
                    store.setFunnel('companion')
                    track('onboarding_step_viewed', { step: 'waitlist' })
                    return
                }
                store.setWaitlisted(false)

                if (state.phase === 'discover' && parked) {
                    if (isAnonymous) {
                        if (parked.industry ?? parked.decidedIndustry ?? parked.industryLabel) store.setIntakePreview(intakePreviewPlan(null, boxesOfIntake(parked)))
                        store.startFunnel(false)
                        return
                    }
                    const saved = await saveForemanIntakeAction(parked).then(
                        () => true,
                        () => false
                    )
                    parkedOwnAsk.current = onboarding.pendingOwnAsk
                    onboarding.clearPendingIntake()
                    store.startFunnel(!saved)
                    track('onboarding_step_viewed', { step: saved ? 'plan' : 'discover' })
                    setSettled(identity)
                    return
                }
                if (!isAnonymous) onboarding.clearPendingIntake()

                if (isAnonymous && state.phase !== 'discover') {
                    if (state.phase === 'plan' && state.arrival) {
                        store.startFunnel(false)
                        track('onboarding_started', { mode: 'foreman', arrival: state.arrival.kind })
                        return
                    }
                    store.setFunnel('companion')
                    return
                }
                if (state.phase === 'discover' && state.arrival?.installed) {
                    await skipOwedWelcomeCard()
                    return
                }
                store.startFunnel(state.phase === 'discover')
                if (state.phase === 'discover') track('onboarding_started', { mode: 'foreman', arrival: intent.current?.kind ?? 'none' })
                track('onboarding_step_viewed', { step: state.phase })
                setSettled(identity)
            })
            .catch(() => useForemanStore.getState().setFunnel('companion'))
    }, [identity, isAnonymous, searchParams])

    const start = useCallback((ownAsk?: string) => {
        if (greeted.current) return
        greeted.current = true

        if (intent.current?.kind === 'prompt') useOnboardingStore.getState().clearPendingFirstAgent()

        const asked = ownAsk?.trim() || parkedOwnAsk.current
        parkedOwnAsk.current = null
        send(asked ? buildOwnKickoff(asked) : buildKickoffMarker(intent.current))
    }, [send])

    useEffect(() => {
        if (funnel !== 'guided' || intake || !restoreDone || messageCount > 0 || isAnonymous || phoneStep !== 'clear' || !identity || settled !== identity) return
        start()
    }, [funnel, intake, restoreDone, messageCount, isAnonymous, phoneStep, identity, settled, start])

    return { start, firstName, arrival, prompted }
}
