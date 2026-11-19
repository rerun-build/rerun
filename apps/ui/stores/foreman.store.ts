import { create } from 'zustand'

import type { OrbActivity } from '@/components/foreman/Orb'
import type { ShownPlan } from '@/components/foreman/widgets/plan-card'
import { type ForemanPlacement, rememberForemanPlacement } from '@/lib/foreman-layout'
import { IDLE_DOCK_FEED, type ForemanDockFeed } from '@/lib/foreman/dock-feed'
import type { ForemanArrival, ForemanBackend } from '@/lib/foreman/phase'
import type { ForemanSurface } from '@/lib/foreman/surface'
import { rememberForemanOpen } from '@/lib/foreman-open'
import { useBoardStore } from '@/stores/board.store'
import type { ForemanTab } from '@moldwright/ui/foreman'
import { randomUuid } from '@/lib/random-uuid'

export type ForemanFunnel = 'unknown' | 'guided' | 'companion'

export type { ForemanTab }

export type StartedLead = { agentId: string; conversationId: string }

type ForemanState = {
    open: boolean | null
    yieldedToSheet: boolean
    placement: ForemanPlacement | null
    dropTarget: ForemanPlacement | null
    tab: ForemanTab
    funnel: ForemanFunnel
    waitlisted: boolean
    activity: OrbActivity
    engineRunId: string | null
    sessionId: string
    backend: ForemanBackend | null
    surface: ForemanSurface | 'unknown'
    planPreview: ShownPlan | null
    intake: boolean
    arrival: ForemanArrival | null
    intakePreview: ShownPlan | null
    pendingPrompt: string | null
    startedLead: StartedLead | null
    engaged: boolean
    dock: ForemanDockFeed
    pillAvailable: boolean
    composerFocusRequest: number
    gettingStartedAvailable: boolean
    gettingStartedOpenRequest: number
    accountSwitches: number
    toggle: () => void
    close: () => void
    yieldToSheet: () => void
    reclaimFromSheet: () => void
    openForFunnel: () => void
    restoreOpen: (open: boolean) => void
    setPlacement: (placement: ForemanPlacement) => void
    restorePlacement: (placement: ForemanPlacement) => void
    setDropTarget: (target: ForemanPlacement | null) => void
    setTab: (tab: ForemanTab) => void
    setFunnel: (funnel: ForemanFunnel) => void
    setWaitlisted: (waitlisted: boolean) => void
    startFunnel: (intake: boolean) => void
    setArrival: (arrival: ForemanArrival | null) => void
    newChat: () => void
    setActivity: (activity: OrbActivity) => void
    setEngineRunId: (engineRunId: string | null) => void
    setSessionId: (sessionId: string, backend?: ForemanBackend) => void
    setSurface: (surface: ForemanSurface) => void
    pinBackend: () => void
    setPlanPreview: (plan: ShownPlan | null) => void
    closeIntake: () => void
    setIntakePreview: (plan: ShownPlan | null) => void
    askForeman: (text: string) => void
    sendToForeman: (text: string) => void
    engage: () => void
    setDock: (dock: ForemanDockFeed) => void
    setPillAvailable: (available: boolean) => void
    requestComposerFocus: () => void
    clearPendingPrompt: () => void
    setStartedLead: (lead: StartedLead | null) => void
    setGettingStartedAvailable: (available: boolean) => void
    openGettingStarted: () => void
    reset: () => void
}

export const useForemanStore = create<ForemanState>()((set, get) => ({
    open: null,
    yieldedToSheet: false,
    placement: null,
    dropTarget: null,
    tab: 'assistant',
    funnel: 'unknown',
    waitlisted: false,
    activity: 'idle',
    engineRunId: null,
    sessionId: randomUuid(),
    backend: null,
    surface: 'unknown',
    planPreview: null,
    intake: false,
    arrival: null,
    intakePreview: null,
    pendingPrompt: null,
    startedLead: null,
    engaged: false,
    dock: IDLE_DOCK_FEED,
    pillAvailable: false,
    composerFocusRequest: 0,
    gettingStartedAvailable: false,
    gettingStartedOpenRequest: 0,
    accountSwitches: 0,
    toggle: () => {
        const next = get().open !== true
        applyOpen(set, next)
        rememberForemanOpen(next)
    },
    close: () => {
        set({ open: false, yieldedToSheet: false })
        rememberForemanOpen(false)
    },
    yieldToSheet: () => set({ open: false, yieldedToSheet: true }),
    reclaimFromSheet: () => {
        if (get().yieldedToSheet) set({ open: true, yieldedToSheet: false })
    },
    openForFunnel: () => {
        applyOpen(set, true)
        set({ tab: 'assistant' })
    },
    restoreOpen: open => {
        if (get().open !== null) return
        set({ open })
    },
    setPlacement: placement => {
        set({ placement })
        rememberForemanPlacement(placement)
    },
    restorePlacement: placement => {
        if (get().placement !== null) return
        set({ placement })
    },
    setDropTarget: dropTarget => set({ dropTarget }),
    setTab: tab => set({ tab }),
    setFunnel: funnel => set({ funnel }),
    setWaitlisted: waitlisted => set({ waitlisted }),
    startFunnel: intake => {
        useBoardStore.getState().selectAgent(null)
        useBoardStore.getState().selectSpace(null)
        set({ funnel: 'guided', intake, open: true, yieldedToSheet: false, tab: 'assistant' })
    },
    setArrival: arrival => set({ arrival }),
    newChat: () => set({ tab: 'assistant', sessionId: randomUuid(), backend: null, activity: 'idle', engineRunId: null, planPreview: null, intake: false, intakePreview: null, dock: IDLE_DOCK_FEED }),
    setActivity: activity => set({ activity }),
    setEngineRunId: engineRunId => set({ engineRunId }),
    setSessionId: (sessionId, backend) => set({ sessionId, backend: backend ?? null }),
    setSurface: surface => set({ surface }),
    pinBackend: () => {
        if (get().backend === null) set({ backend: selectForemanBackend(get()) })
    },
    setPlanPreview: planPreview => set({ planPreview }),
    closeIntake: () => set({ intake: false }),
    setIntakePreview: intakePreview => set({ intakePreview }),
    askForeman: text => {
        applyOpen(set, true)
        rememberForemanOpen(true)
        set({ pendingPrompt: text, tab: 'assistant' })
    },
    sendToForeman: text => set({ pendingPrompt: text, engaged: true }),
    engage: () => set({ engaged: true }),
    setDock: dock => set({ dock }),
    setPillAvailable: pillAvailable => set({ pillAvailable }),
    requestComposerFocus: () => set(state => ({ composerFocusRequest: state.composerFocusRequest + 1 })),
    clearPendingPrompt: () => set({ pendingPrompt: null }),
    setStartedLead: startedLead => set({ startedLead }),
    setGettingStartedAvailable: gettingStartedAvailable => set({ gettingStartedAvailable }),
    openGettingStarted: () => set(state => ({ gettingStartedOpenRequest: state.gettingStartedOpenRequest + 1 })),
    reset: () =>
        set(state => ({
            accountSwitches: state.accountSwitches + 1,
            yieldedToSheet: false,
            funnel: 'unknown',
            waitlisted: false,
            activity: 'idle',
            engineRunId: null,
            sessionId: randomUuid(),
            backend: null,
            surface: 'unknown',
            planPreview: null,
            intake: false,
            arrival: null,
            intakePreview: null,
            pendingPrompt: null,
            startedLead: null,
            engaged: false,
            dock: IDLE_DOCK_FEED,
            gettingStartedAvailable: false,
        })),
}))

function applyOpen(set: (partial: Partial<ForemanState>) => void, open: boolean) {
    if (open) {
        useBoardStore.getState().selectAgent(null)
        useBoardStore.getState().selectSpace(null)
    }
    set({ open, yieldedToSheet: false })
}

export const selectForemanBackend = (state: ForemanState): ForemanBackend => state.backend ?? (state.surface === 'engine' ? 'engine' : 'hub')

export const selectForemanVisible = (state: ForemanState): boolean => state.surface !== 'none'

export const selectForemanOpen = (state: ForemanState) => state.open === true

export function foremanOrbState({ open, activity }: { open: boolean; activity: OrbActivity }): OrbActivity {
    if (activity !== 'idle') return activity
    return open ? 'listening' : 'idle'
}
