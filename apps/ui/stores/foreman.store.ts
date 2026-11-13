import { create } from 'zustand'

import type { OrbActivity } from '@/components/foreman/Orb'
import type { ShownPlan } from '@/components/foreman/widgets/plan-card'
import { type ForemanPlacement, rememberForemanPlacement } from '@/lib/foreman-layout'
import { IDLE_DOCK_FEED, type ForemanDockFeed } from '@/lib/foreman/dock-feed'
import type { ForemanArrival, ForemanBackend } from '@/lib/foreman/phase'
import type { ForemanSurface } from '@/lib/foreman/surface'
import { rememberForemanOpen } from '@/lib/foreman-open'
import { useBoardStore } from '@/stores/board.store'
import type { ForemanTab } from '@rerun/ui/foreman'
import { randomUuid } from '@/lib/random-uuid'

export type ForemanFunnel = 'unknown' | 'guided' | 'companion'

export type { ForemanTab }

export type StartedLead = { agentId: string; conversationId: string }

type ForemanState = {
    /** `null` tant que le client n'a pas tranché : le premier rendu suit alors ce que dit le cookie. */
    open: boolean | null
    /** La colonne s'est effacée devant une sheet d'agent : elle revient quand la sheet se referme. */
    yieldedToSheet: boolean
    /** Où la colonne se pose. `null` tant que le client n'a pas tranché, comme `open`. */
    placement: ForemanPlacement | null
    /** La place que viserait la colonne si on la lâchait, tant qu'elle est tenue par son en-tête. */
    dropTarget: ForemanPlacement | null
    /** Une préférence d'écran comme la place : un changement de compte ne la touche pas. */
    tab: ForemanTab
    /**
     * Ce que la colonne est en train de faire. `unknown` tant que la phase n'est pas revenue du
     * serveur : les fiches de liens profonds l'attendent pour savoir si elles ont le droit de
     * s'ouvrir, sinon elles se posent par-dessus une conversation qui vient de commencer.
     */
    funnel: ForemanFunnel
    /**
     * Le pool d'engines est vide et ce compte n'a pas encore de machine : le mur de waitlist couvre
     * le board et rien ne part vers le Foreman. Relu à chaque identité, comme la phase.
     */
    waitlisted: boolean
    activity: OrbActivity
    /** The run the engine foreman is streaming or was reattached to, so it can be stopped or picked up again. */
    engineRunId: string | null
    /** La conversation en cours. En changer vide le chat : c'est tout ce que fait « New task ». */
    sessionId: string
    /**
     * Qui sert la conversation en cours. `null` tant qu'aucun message n'est parti : elle suit alors
     * `surface`, puis se fige au premier envoi et ne change plus.
     */
    backend: ForemanBackend | null
    /**
     * Le Foreman auquel parle le workspace : celui du hub pendant l'onboarding, celui de l'engine
     * dès que le build a réclamé la machine, aucun sans machine. `unknown` tant que la phase n'est
     * pas revenue du serveur : la colonne se rend alors comme le dit le cookie.
     */
    surface: ForemanSurface | 'unknown'
    /**
     * L'organisation que le Foreman a posée sur la table, telle que sa carte la lit. C'est le seul
     * lien entre la colonne, à droite, et le board, à gauche, qui la dessine en aperçu tant qu'aucune
     * vraie Box n'existe. `null` = rien à dessiner.
     */
    planPreview: ShownPlan | null
    /**
     * La carte d'accueil, qui pose les quatre questions du tunnel avant que le Foreman ne réfléchisse
     * à quoi que ce soit. Tant qu'elle est là, aucun message n'est parti.
     */
    intake: boolean
    /**
     * La template ou le coworker partagé sur lequel le visiteur est arrivé. Tant qu'il n'est pas
     * installé la colonne porte son tunnel (compte, téléphone, trial, install) à la place de la
     * carte d'accueil, qui ne vient qu'après. `null` pour toute autre arrivée.
     */
    arrival: ForemanArrival | null
    /**
     * Les divisions que la carte dessine dès qu'elle connaît l'industrie. Champ à part de
     * `planPreview` et pas le même : la colonne réécrit `planPreview` à chaque message, `null`
     * compris, et effacerait cet aperçu-là au premier mot du Foreman.
     */
    intakePreview: ShownPlan | null
    /**
     * Un message confié au Foreman depuis l'extérieur de la colonne (une étape de la checklist du
     * board). La colonne l'envoie elle-même, une fois la conversation restaurée et le tour fini.
     */
    pendingPrompt: string | null
    /** The lead whose install is known to have started, and the conversation it runs in. */
    startedLead: StartedLead | null
    /**
     * The parked Foreman was called on with the column closed: the conversation is fetched without
     * waiting for the column to open, so what is typed or said in the pill has somewhere to go.
     */
    engaged: boolean
    /** What the column tells the parked Foreman about the conversation it cannot show. */
    dock: ForemanDockFeed
    /** The pill is there to take a message: a desktop, a companion, the column closed. */
    pillAvailable: boolean
    /** Bumped to send the caret to whichever composer is on screen, the pill's or the column's. */
    composerFocusRequest: number
    /** La checklist du board existe pour cet utilisateur, même masquée : le menu profil la rouvre. */
    gettingStartedAvailable: boolean
    // Incrémenté par le menu profil : la pastille s'ouvre (et se ré-affiche) à chaque changement.
    gettingStartedOpenRequest: number
    /** Incrémenté par `reset` : la clé de la colonne, pour qu'un changement de compte la remonte à neuf. */
    accountSwitches: number
    toggle: () => void
    close: () => void
    yieldToSheet: () => void
    reclaimFromSheet: () => void
    openForFunnel: () => void
    openInCenter: () => void
    restoreOpen: (open: boolean) => void
    setPlacement: (placement: ForemanPlacement) => void
    restorePlacement: (placement: ForemanPlacement) => void
    setDropTarget: (target: ForemanPlacement | null) => void
    setTab: (tab: ForemanTab) => void
    setFunnel: (funnel: ForemanFunnel) => void
    setWaitlisted: (waitlisted: boolean) => void
    /** Entrer dans le tunnel : le mode, la carte d'accueil et l'ouverture, d'un seul coup. */
    startFunnel: (intake: boolean) => void
    setArrival: (arrival: ForemanArrival | null) => void
    newChat: () => void
    setActivity: (activity: OrbActivity) => void
    setEngineRunId: (engineRunId: string | null) => void
    setSessionId: (sessionId: string, backend?: ForemanBackend) => void
    setSurface: (surface: ForemanSurface) => void
    /** Fige le backend d'une conversation qui n'a encore rien envoyé. */
    pinBackend: () => void
    setPlanPreview: (plan: ShownPlan | null) => void
    closeIntake: () => void
    setIntakePreview: (plan: ShownPlan | null) => void
    /** Ouvrir la colonne et lui confier un message, comme si on l'avait tapé. */
    askForeman: (text: string) => void
    /** Hand the Foreman a message and leave the column closed: the parked Foreman shows the turn. */
    sendToForeman: (text: string) => void
    engage: () => void
    setDock: (dock: ForemanDockFeed) => void
    setPillAvailable: (available: boolean) => void
    requestComposerFocus: () => void
    clearPendingPrompt: () => void
    setStartedLead: (lead: StartedLead | null) => void
    setGettingStartedAvailable: (available: boolean) => void
    openGettingStarted: () => void
    /**
     * Changer de compte sans recharger (un anonyme qui se connecte) : le tunnel, la carte d'accueil
     * et la conversation étaient ceux du visiteur laissé derrière. L'ouverture et la place restent,
     * ce sont des préférences d'écran.
     */
    reset: () => void
}

// La conversation, elle, n'est pas persistée : elle vit côté serveur, et la colonne va la rechercher
// au montage. Seule l'ouverture l'est, et seulement quand elle vient d'un geste (lib/foreman-open).
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
    // Une seule fenêtre à la fois : ouvrir la colonne referme la sélection, et une sheet qui s'ouvre
    // met la colonne en retrait (BoardChatSplit) sans la fermer pour de bon, même quand c'est le
    // Foreman qui l'ouvre pour montrer ce qu'il vient de faire.
    toggle: () => {
        const next = get().open !== true
        applyOpen(set, next)
        rememberForemanOpen(next)
    },
    close: () => {
        set({ open: false, yieldedToSheet: false })
        rememberForemanOpen(false)
    },
    // Pas une préférence : la colonne reviendra d'elle-même, ni le cookie ni le localStorage n'en savent rien.
    yieldToSheet: () => set({ open: false, yieldedToSheet: true }),
    reclaimFromSheet: () => {
        if (get().yieldedToSheet) set({ open: true, yieldedToSheet: false })
    },
    // Le tunnel s'ouvre la colonne tout seul : ce n'est pas un geste, donc ça ne devient pas une
    // préférence. Une fois onboardé, l'utilisateur retrouve le défaut de son écran.
    openForFunnel: () => {
        applyOpen(set, true)
        set({ tab: 'assistant' })
    },
    // The Simple view puts it in the middle: no gesture on the board's column, so no preference written.
    openInCenter: () => applyOpen(set, true),
    // Ce que le client a lu au montage. Un kickoff qui a déjà tranché garde la main.
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
    // En un seul `set` et pas trois : entre « le tunnel commence » et « la carte est là », le
    // kickoff verrait une découverte sans carte devant elle et enverrait son marqueur, ce que toute
    // cette carte existe pour éviter.
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
    // L'aperçu de la carte survit à sa fermeture : les Box restent dessinées pendant que le Foreman
    // réfléchit, jusqu'à ce que son propre plan les remplace.
    closeIntake: () => set({ intake: false }),
    setIntakePreview: intakePreview => set({ intakePreview }),
    // Un geste, comme `toggle` : l'ouverture devient la préférence.
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

/** Le backend qui sert la conversation affichée, figé ou pas encore. */
export const selectForemanBackend = (state: ForemanState): ForemanBackend => state.backend ?? (state.surface === 'engine' ? 'engine' : 'hub')

/** Pas de machine hors onboarding : ni colonne ni orbe. */
export const selectForemanVisible = (state: ForemanState): boolean => state.surface !== 'none'

/** Pour tous ceux qui n'ont rien à faire du `null` : non tranché, la colonne n'est pas ouverte. */
export const selectForemanOpen = (state: ForemanState) => state.open === true

/**
 * L'état que la bête affiche. Le travail en cours l'emporte toujours ; sinon c'est l'ouverture du
 * panneau qui parle : parkée dans le coin elle sommeille, déployée elle attend qu'on lui parle,
 * yeux ouverts. Sans ça les deux moments du Foreman se ressemblaient.
 */
export function foremanOrbState({ open, activity }: { open: boolean; activity: OrbActivity }): OrbActivity {
    if (activity !== 'idle') return activity
    return open ? 'listening' : 'idle'
}
