'use client'

import { onboardingStateSchema, type OnboardingState } from '@rerun/contracts'
import { useSearchParams, type ReadonlyURLSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { openOnboardingHandoffAction, recordOnboardingArrivalAction } from '@/app/api/_actions/onboarding-dialog.actions'
import { refreshForemanSurface } from '@/components/foreman/useForemanKickoff'
import { buildKickoffMarker } from '@/lib/foreman/kickoff-marker'
import { useBoardStore } from '@/stores/board.store'
import { readArrivingIntent } from '@/lib/foreman/arriving-intent'
import { ONBOARDING_TRIGGER, useBillingStore } from '@/stores/billing.store'
import { useForemanStore } from '@/stores/foreman.store'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'

// Steps that move on their own are read again meanwhile: the waiting list lifts as soon as a machine
// frees up, and a trial paid in another tab, or whose webhook came late, lands while the step waits.
const POLL_MS: Partial<Record<OnboardingState['step'], number>> = { waitlist: 60_000, trial: 10_000 }

export type OnboardingDialogState = { state: OnboardingState | null; failed: boolean; reload: () => Promise<void>; checkoutOpen: boolean }

async function fetchOnboardingState(): Promise<OnboardingState> {
    const res = await fetch('/api/onboarding/state', { cache: 'no-store' })
    if (!res.ok) throw new Error(`onboarding state ${res.status}`)
    return onboardingStateSchema.parse(await res.json())
}

// The link they arrived on is written down before the first read: a template or a shared coworker
// skips the questions. Once per workspace, and only while it has not been onboarded.
async function recordArrival(searchParams: ReadonlyURLSearchParams, onboarded: boolean): Promise<void> {
    if (onboarded) return
    const intent = readArrivingIntent(searchParams, useOnboardingStore.getState())
    if (!intent) return
    const ref = intent.kind === 'template' ? intent.slug : intent.kind === 'share' ? intent.token : intent.text
    await recordOnboardingArrivalAction(intent.kind, ref).catch(() => {})
}

/**
 * Where the onboarding dialog stands, read from the server after every step it closes. A workspace
 * the dialog walks has its board drawn as the onboarding's (`guided`) until the dialog is done.
 */
export function useOnboardingDialog(): OnboardingDialogState {
    const { workspace, isAnonymous, phoneStep } = useSession()
    const searchParams = useSearchParams()
    const [state, setState] = useState<OnboardingState | null>(null)
    const [failed, setFailed] = useState(false)
    const workspaceId = workspace?.id ?? null
    const onboarded = !!workspace?.onboarded_at
    const subscription = workspace?.subscription_status ?? null
    const recordedFor = useRef<number | null>(null)
    const params = useRef(searchParams)
    useEffect(() => {
        params.current = searchParams
    }, [searchParams])

    const reload = useCallback(async () => {
        try {
            const next = await fetchOnboardingState()
            setFailed(false)
            setState(next)
        } catch {
            setFailed(true)
        }
    }, [])

    useEffect(() => {
        if (workspaceId === null || isAnonymous || phoneStep === 'unknown') return
        const first = recordedFor.current !== workspaceId
        recordedFor.current = workspaceId
        void (first ? recordArrival(params.current, onboarded) : Promise.resolve()).then(reload)
        // The phone step and the trial close in the session (`phoneStep`, `subscription`): the step is
        // read again then.
    }, [workspaceId, isAnonymous, phoneStep, onboarded, subscription, reload])

    const step = state?.step
    const checkoutOpen = useBillingStore(s => s.open)
    useEffect(() => {
        const every = step ? POLL_MS[step] : undefined
        if (!every || checkoutOpen) return
        const timer = setInterval(() => void reload(), every)
        return () => clearInterval(timer)
    }, [step, checkoutOpen, reload])

    // The trial is today's checkout: opened once when the step comes up, read again once it closes.
    const dialogWorkspace = state?.dialog ?? false
    const checkoutShown = useRef(false)
    useEffect(() => {
        if (!dialogWorkspace || step !== 'trial') {
            checkoutShown.current = false
            return
        }
        if (checkoutShown.current) return
        checkoutShown.current = true
        useBillingStore.getState().openBilling(undefined, ONBOARDING_TRIGGER)
    }, [dialogWorkspace, step])
    const checkoutWasOpen = useRef(false)
    useEffect(() => {
        if (checkoutWasOpen.current && !checkoutOpen && step === 'trial') void reload()
        checkoutWasOpen.current = checkoutOpen
    }, [checkoutOpen, step, reload])

    // The board draws the onboarding's preview behind the dialog. Once it hands over, the column is
    // the Chief of Staff's own, where the first team is chosen.
    const handoff = dialogWorkspace && step === 'handoff'
    const past = step === 'done' || step === 'handoff'
    useEffect(() => {
        if (!dialogWorkspace) return
        useForemanStore.getState().setFunnel(past ? 'companion' : 'guided')
        useForemanStore.getState().setOnboardingHandoff(handoff)
    }, [dialogWorkspace, past, handoff])

    // Opened once per workspace: whoever takes it starts the conversation, the box now answers.
    const opened = useRef(false)
    useEffect(() => {
        if (!handoff || opened.current) return
        opened.current = true
        void (async () => {
            await refreshForemanSurface()
            if (await openOnboardingHandoffAction().catch(() => false)) useForemanStore.getState().askForeman(buildKickoffMarker(null))
        })()
    }, [handoff])

    // The team lands on the board: the handoff is over.
    const agentCount = useBoardStore(s => s.agents.length)
    useEffect(() => {
        if (handoff && agentCount > 0) void Promise.resolve().then(reload)
    }, [handoff, agentCount, reload])

    return { state, failed, reload, checkoutOpen }
}
