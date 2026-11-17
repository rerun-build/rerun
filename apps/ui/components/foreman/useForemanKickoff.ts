'use client'

import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { track } from '@rerun/analytics/client'

import { waiveForemanProfileAction } from '@/app/api/_actions/foreman-intake.actions'
import { readArrivingIntent } from '@/lib/foreman/arriving-intent'
import { buildKickoffMarker, encodeIntent, type KickoffIntent } from '@/lib/foreman/kickoff-marker'
import { type ForemanArrival, type ForemanPhase } from '@/lib/foreman/phase'
import type { ForemanSurface } from '@/lib/foreman/surface'
import { arrivalPreviewPlan } from '@/lib/onboarding/intake'
import { useForemanStore } from '@/stores/foreman.store'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'

// Who opens the conversation. A first arrival is met by the foreman rather than by an empty board:
// the column opens by itself and the first message is one the user never typed, so the foreman is
// the one who speaks first.
//
// A new workspace answers its questions on the welcome page before it gets here, so this is mostly
// the funnel of a workspace that started it before that page existed, or that arrived on a template
// or a shared coworker. Everyone else is left alone: the phase comes back `companion` for any
// workspace that is already running, and the column only learns which foreman it talks to, the one
// on the engine, or none at all when the workspace has no machine. The welcome page's hand-over
// comes back `greet`: the foreman on the engine owes them its first words (ForemanColumn).
type ForemanStateAnswer = { phase: ForemanPhase; firstName?: string; arrival?: ForemanArrival | null; surface: ForemanSurface; greet?: boolean }

async function fetchForemanState(query = ''): Promise<ForemanStateAnswer | null> {
    const res = await fetch(`/api/chat/foreman/state${query}`)
    return res.ok ? ((await res.json()) as ForemanStateAnswer) : null
}

/**
 * Asks again which foreman the workspace talks to: once the build has claimed the machine, or when a
 * foreman turned a message away because the workspace moved on under an open tab.
 */
export async function refreshForemanSurface(): Promise<void> {
    const state = await fetchForemanState().catch(() => null)
    if (!state) return
    useForemanStore.getState().setSurface(state.surface)
    if (state.phase === 'companion') useForemanStore.getState().setFunnel('companion')
}

// A ready-made arrival is never asked the welcome card after its install: the coworker's own chat is
// already asking what it needs, and a second questionnaire beside it read as two chats at once.
async function skipOwedWelcomeCard(): Promise<void> {
    await waiveForemanProfileAction().catch(() => {})
    const store = useForemanStore.getState()
    store.setArrival(null)
    store.setFunnel('companion')
    await refreshForemanSurface()
}

/**
 * Where a build that just landed leaves the column. Almost always with the foreman on the engine;
 * a workspace that installed what it arrived on before anyone asked who it is, `skipped`: the welcome
 * card it still owes is given up and the column gets out of the way of the coworker's chat.
 */
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
    const { workspace, phoneStep } = useSession()
    const searchParams = useSearchParams()
    const funnel = useForemanStore(state => state.funnel)
    const [firstName, setFirstName] = useState<string | null>(null)
    // Ce avec quoi ils sont arrivés, nommé par le serveur. Dans le store et pas ici : la colonne en
    // fait son tunnel tant que ce n'est pas installé, le board le dessine, et le mur du téléphone lui
    // cède la place.
    const arrival = useForemanStore(state => state.arrival)
    // The phase is asked once per workspace, not once per mount: switching workspaces swaps the one
    // under the column, and the answer given for the previous one no longer holds.
    const identity = workspace ? String(workspace.id) : null
    const asked = useRef<string | null>(null)
    const [settled, setSettled] = useState<string | null>(null)
    const greeted = useRef(false)
    const intent = useRef<KickoffIntent | null>(null)
    // Arrived with a prompt written on the landing: they already said what they want.
    const [prompted, setPrompted] = useState(false)

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
                // Tout ce qui n'est pas un tunnel rend la main à ce qui existait avant : la fiche
                // d'un lien profond, elle, n'attend que ça pour s'ouvrir.
                if (!state || state.phase === 'companion') {
                    store.setArrival(null)
                    store.setGreetPending(!!state?.greet)
                    store.setFunnel('companion')
                    return
                }
                setFirstName(state.firstName?.trim() || null)
                store.setArrival(state.arrival ?? null)
                // Rien n'est encore construit : ce qu'ils ont cliqué est posé sur le board, éteint.
                if (state.arrival && !state.arrival.installed && state.phase !== 'discover') store.setIntakePreview(arrivalPreviewPlan(state.arrival.coworker ?? state.arrival.title))

                // Plus d'engine dans le pool : le mur de waitlist prend l'écran et rien ne part.
                if (state.phase === 'waitlist') {
                    store.setWaitlisted(true)
                    store.setFunnel('companion')
                    track('onboarding_step_viewed', { step: 'waitlist' })
                    return
                }
                store.setWaitlisted(false)

                if (state.phase === 'discover' && state.arrival?.installed) {
                    await skipOwedWelcomeCard()
                    return
                }
                // The welcome page asks the questions of a new workspace on the web. A workspace still
                // in `discover` here came another way (an invitation in flight): the Chief of Staff of
                // the hub asks them in the conversation.
                store.startFunnel()
                track('onboarding_step_viewed', { step: state.phase })
                setSettled(identity)
            })
            .catch(() => useForemanStore.getState().setFunnel('companion'))
    }, [identity, searchParams])

    const start = useCallback(() => {
        if (greeted.current) return
        greeted.current = true

        // Le brouillon de la landing est consommé ici, et pas plus tard : sans ça, dès que
        // save_profile stampe l'onboarding, la reprise de HomeContent le voit « onboardé » et crée
        // l'agent dans le dos du Foreman, en plein tunnel. Le slug d'une template et le token d'un
        // partage restent parqués, eux : c'est ce qui tient les autres chemins d'installation.
        if (intent.current?.kind === 'prompt') useOnboardingStore.getState().clearPendingFirstAgent()

        send(buildKickoffMarker(intent.current))
    }, [send])

    // Only once the column knows what it is holding: a setup picked up mid-way resumes on its own
    // transcript, and a second marker there would restart the greeting on top of it. Never before the
    // phase has been read for the workspace in place, nor while the phone wall is up or may still
    // rise: the foreman waits for the account to be let in.
    useEffect(() => {
        if (funnel !== 'guided' || !restoreDone || messageCount > 0 || phoneStep !== 'clear' || !identity || settled !== identity) return
        start()
    }, [funnel, restoreDone, messageCount, phoneStep, identity, settled, start])

    return { start, firstName, arrival, prompted }
}
