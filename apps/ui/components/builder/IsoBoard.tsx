'use client'

import { IsoGrid, SPACE_COLOR, agentTileStyle, type Container, type ContainerSide, type IsoCamera, type IsoFocusRequest, type TileResults } from '@rerun/ui/iso-grid'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '@rerun/ui/primitives/use-is-mobile'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { placementLabel, useBoardStore } from '@/stores/board.store'
import { useBoardCoverStore } from '@/stores/board-cover.store'
import { useForemanStore } from '@/stores/foreman.store'
import { useBillingStore } from '@/stores/billing.store'
import { hasPendingStart, useOnboardingStore } from '@/stores/onboarding.store'
import { isSubscriptionEntitled } from '@/cloud/billing'
import { readHeroAgentApps, readHeroAgentName } from '@/lib/onboarding/hero-handoff'
import { useResumePendingStart } from '@/lib/onboarding/useResumePendingStart'
import { nameAgentFromPromptAction } from '@/app/api/_actions/onboarding.actions'
import { useSession } from '@/supabase/session/SessionProvider'
import { ClaimSpaceDialog, type ClaimSpaceTarget } from '@/components/dialogs/ClaimSpaceDialog'
import { CursorOverlay } from '@/components/layout/CursorOverlay'
import { BoardContextMenu, type BoardContextTarget } from '@/components/builder/BoardContextMenu'
import { isPlanPreviewId } from '@/lib/foreman/plan-scene'
import { usePlanPreviewScene } from '@/components/builder/usePlanPreviewScene'
import { BoardDiscoveries } from '@/components/builder/discoveries/BoardDiscoveries'
import { useCompanyDiscoveries } from '@/components/builder/discoveries/useCompanyDiscoveries'
import { useDiscoveriesStore } from '@/stores/discoveries.store'
import { useTeamCursors } from '@/supabase/useTeamCursors'
import { useWindowFocused } from '@/hooks/useWindowFocused'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { flushCamera, readCamera, writeCamera } from '@/lib/camera-storage'
import { attentionCountByAgent } from '@/lib/board/attention'
import { useNextRuns } from '@/hooks/useNextRuns'
import { useUnseenGroups } from '@/hooks/useUnseenGroups'
import { useUnseenRunsStore } from '@/stores/unseen-runs.store'
import { containerFromSpace, linksFromSessions, tileFromAgent } from '@/lib/board/iso-adapter'
import { useAgentIdeas } from '@/lib/agent-ideas/useAgentIdeas'
import { boxCtaExamples, boxCtaLabel } from '@/lib/onboarding/box-themes'
import { useOnboardingIndustry } from '@/lib/onboarding/useOnboardingIndustry'
import { AGENT_SPAN } from '@/lib/board/iso'
import { freeRectOnSide } from '@/lib/board/space-layout'
import { SIDE_PANEL_GAP, loadSidePanelWidth } from '@/lib/side-panel-width'
import type { SpacePublic } from '@/lib/board/types'


const PLACEHOLDER_ID = '__placeholder__'

// Container « fantôme » 8×8 centré sur la grille (GRID_SIZE=12) : le footprint colle à SPACE_SIZE=8
// (space.actions.ts) pour que le placeholder ait la même taille que le space réellement créé. Le
// losange s'étend de col_start à col_end+1, donc (2 → 9) ⇒ centre = (2 + 10) / 2 = 6 = GRID_SIZE / 2,
// il apparaît au milieu de l'écran.
const PLACEHOLDER_CONTAINER: Container = { id: PLACEHOLDER_ID, label: null, color: SPACE_COLOR, col_start: 2, row_start: 2, col_end: 9, row_end: 9, variant: 'placeholder', placeholderLabel: 'Click to recruit your first coworker' }

// SidePanel's `md:` breakpoint.
const PANEL_SHEET_QUERY = '(max-width: 767.98px)'

// Le label du placeholder s'anime caractère par caractère sur une seule ligne non coupée : un titre
// de template éditorial (non borné) sortirait du losange.
function clampLabel(title: string): string {
    return title.length > 24 ? `${title.slice(0, 23)}…` : title
}

export function IsoBoard({ onRequestRecruitAgent, onRequestBoxAgent, initialSpaces = [] }: { onRequestRecruitAgent?: () => void; onRequestBoxAgent?: (spaceId: string) => void; initialSpaces?: SpacePublic[] }) {
    const { workspace, isAnonymous } = useSession()
    const { access: workspaceAccess, needsMachineReason } = useWorkspaceAccess()
    const { cursors, onPointerWorldMove } = useTeamCursors(workspace?.id)
    const agents = useBoardStore(s => s.agents)
    const spaces = useBoardStore(s => s.spaces)
    const sessions = useBoardStore(s => s.sessions)
    const liveLinks = useBoardStore(s => s.liveLinks)
    const mode = useBoardStore(s => s.mode)
    const selectedAgentId = useBoardStore(s => s.selectedAgentId)
    const justPlacedAgentId = useBoardStore(s => s.justPlacedAgentId)
    const recenterSignal = useBoardStore(s => s.recenterSignal)
    const cameraFocus = useBoardStore(s => s.cameraFocus)
    const selectedSpaceId = useBoardStore(s => s.selectedSpaceId)
    // Under md the side panel and the foreman are bottom sheets, the board stays live above them.
    const foremanFunnel = useForemanStore(s => s.funnel)
    const belowMd = useIsMobile(PANEL_SHEET_QUERY)
    const dialogCoversBoard = useBoardCoverStore(s => s.covers > 0)
    const windowFocused = useWindowFocused()
    const placingAgentId = useBoardStore(s => s.placingAgentId)
    const placement = useBoardStore(s => s.placement)
    const startingFirstAgent = useBoardStore(s => s.startingFirstAgent)
    const hydrated = useBoardStore(s => s.hydrated)

    const pendingTemplate = useOnboardingStore(s => s.pendingTemplate)
    const setPendingFirstAgent = useOnboardingStore(s => s.setPendingFirstAgent)
    const setPendingTemplate = useOnboardingStore(s => s.setPendingTemplate)
    const setPendingShareLink = useOnboardingStore(s => s.setPendingShareLink)
    const markFirstAgentFromPrompt = useOnboardingStore(s => s.markFirstAgentFromPrompt)

    const selectAgent = useBoardStore(s => s.selectAgent)
    const selectSpace = useBoardStore(s => s.selectSpace)
    const pushPlacement = useBoardStore(s => s.pushPlacement)
    const confirmPlacement = useBoardStore(s => s.confirmPlacement)
    const cancelPlacement = useBoardStore(s => s.cancelPlacement)
    const moveAgent = useBoardStore(s => s.moveAgent)
    const updateSpace = useBoardStore(s => s.updateSpace)
    const moveSpace = useBoardStore(s => s.moveSpace)
    const _localUpdateSpace = useBoardStore(s => s._localUpdateSpace)
    const _setResizingSpaceId = useBoardStore(s => s._setResizingSpaceId)

    // Avant l'hydratation client, on s'appuie sur les données fetchées côté serveur (zéro flash).
    // Après hydratation, le store fait foi et les changements live prennent le relais.
    const useServerData = !hydrated
    const realSpaces = useServerData ? initialSpaces : spaces

    // Bloc « fantôme » incitatif : aucun space créé. C'est le point d'entrée du recrutement du
    // premier agent (au clic : la survey de profilage, puis la template library).
    // Pendant un placement, on garde le container comme zone de drop mais on bascule en variant
    // « default » (simple zone colorée qui se surligne au survol), sans le visuel incitatif
    // (border beam, glow, label « Click to recruit »).
    const showPlaceholder = realSpaces.length === 0
    // Une file dont la dernière tuile est posée n'est plus un placement : elle ne survit que pour
    // garder ses tuiles à l'écran le temps que les vraies arrivent.
    const placingFromQueue = !!placement && !placement.installing
    const placing = placingFromQueue || !!placingAgentId
    // Le sandbox n'est pas un onboarding : son engine lui est attribué automatiquement
    // (useEnsureSandboxSpace). Tant qu'il n'a pas atterri, on montre l'attribution en cours au lieu
    // du parcours « recrute ton premier agent », qui finirait sur le paywall.
    const isSandbox = workspace?.is_sandbox === true
    // Une template parkée (lien partagé) remplace la promesse « recrute ton premier agent » par ce
    // qui va réellement atterrir, à l'attente comme au chargement.
    const parkedTitle = pendingTemplate ? clampLabel(pendingTemplate.title) : null
    // L'onboarding se joue entièrement dans le Foreman, qui crée la Box lui-même : tant qu'elle n'est
    // pas là, le plan reste vide plutôt que de porter une promesse que personne ne vient tenir. Les
    // états qui disent quelque chose de vrai (attribution en cours, template parkée, placement en
    // cours) gardent leur fantôme, comme le compte déjà onboardé dont la Box a été supprimée : le
    // placeholder est son seul accès à la library.
    //
    // C'est le tunnel qui fait foi, pas `onboarded_at` : le Foreman stampe celui-ci dès
    // save_profile, donc à la deuxième question, et le fantôme revenait au milieu de la conversation.
    // Tant que la phase n'est pas revenue du serveur on suit la même supposition que le kickoff,
    // sinon le fantôme s'affiche le temps d'un aller-retour.
    const guidedByForeman = foremanFunnel === 'guided' || (foremanFunnel === 'unknown' && !workspace?.onboarded_at)
    // The welcome card of a workspace that installed first is answered beside a board that is
    // already built: nothing is left to sketch on it.
    const installedFirst = useForemanStore(s => s.arrival?.installed === true)
    const emptyOnboardingBoard = !isSandbox && guidedByForeman && !startingFirstAgent && !placing && !parkedTitle && !installedFirst
    // L'organisation que le Foreman vient de proposer, dessinée là où elle atterrira vraiment. Elle
    // se superpose au board plutôt qu'elle ne le remplace : les Box viennent du même
    // `findRadialRect` des deux côtés, donc chaque vraie Box se pose exactement sur son fantôme, qui
    // s'efface. L'aperçu s'en va division par division au lieu de disparaître d'un bloc à la
    // première, et les autres états du fantôme (sandbox, template parkée, placement) sont déjà
    // exclus par `emptyOnboardingBoard`.
    // Ce que la recherche sur l'entreprise trouve, posé par-dessus le board tant qu'il n'a que
    // l'aperçu à montrer. L'exploration complète ne se relit qu'une fois la carte d'accueil rendue
    // et le compte créé : avant, c'est le flux de la carte qui alimente les mêmes cartes.
    const discoveries = useDiscoveriesStore(s => s.state)
    const discoveriesDomain = useDiscoveriesStore(s => s.domain)
    const intakeOpen = useForemanStore(s => s.intake)
    useCompanyDiscoveries(emptyOnboardingBoard && !isAnonymous && !intakeOpen)
    const showDiscoveries = emptyOnboardingBoard && !!discoveriesDomain && discoveries.entries.length > 0
    const builtRects = useMemo(() => realSpaces.map(space => ({ col_start: space.col_start, row_start: space.row_start, col_end: space.col_end, row_end: space.row_end })), [realSpaces])
    const planPreview = usePlanPreviewScene(emptyOnboardingBoard, builtRects)
    const previewing = !!planPreview

    // Une Box sans agent invite à en recruter un : sa pastille ouvre la dialog New agent sur les
    // idées qui lui reviennent. Jamais avant l'hydratation, où toutes les Box paraissent vides, ni
    // pendant le tunnel du Foreman, qui pose la Box puis l'agent, ni quand le bouton New agent de la
    // toolbar est lui-même fermé.
    const agentIdeas = useAgentIdeas()
    const industry = useOnboardingIndustry()
    const invitesAgents = hydrated && !!workspace && !isSandbox && !isAnonymous && !needsMachineReason && !guidedByForeman && !startingFirstAgent && !placement && !placingAgentId && !previewing && mode !== 'space'
    const boxInvites = useMemo(() => {
        const invites = new Map<string, Pick<Container, 'cta' | 'ctaExamples'>>()
        if (!invitesAgents) return invites
        const agentNames = agents.map(a => a.name)
        for (const space of realSpaces) {
            if (agents.some(a => a.spaceId === space.id)) continue
            invites.set(space.id, {
                cta: boxCtaLabel(space.name),
                ctaExamples: boxCtaExamples({ boxName: space.name, industry, ideas: agentIdeas, agentNames }),
            })
        }
        return invites
    }, [invitesAgents, agents, realSpaces, agentIdeas, industry])

    const boardContainers = useMemo<Container[]>(
        () =>
            showPlaceholder
                ? emptyOnboardingBoard
                    ? []
                    : [
                          isSandbox
                              ? workspaceAccess === 'paused'
                                  ? { ...PLACEHOLDER_CONTAINER, variant: 'default' as const, placeholderLabel: undefined }
                                  : { ...PLACEHOLDER_CONTAINER, variant: 'loading' as const, placeholderLabel: 'Preparing your sandbox…' }
                              : startingFirstAgent
                                ? { ...PLACEHOLDER_CONTAINER, variant: 'loading' as const, placeholderLabel: parkedTitle ? `Setting up ${parkedTitle}…` : 'Setting up your coworker…' }
                                : placing
                                  ? { ...PLACEHOLDER_CONTAINER, variant: 'default' as const, placeholderLabel: undefined }
                                  : parkedTitle
                                    ? { ...PLACEHOLDER_CONTAINER, placeholderLabel: `Click to install ${parkedTitle}` }
                                    : PLACEHOLDER_CONTAINER,
                      ]
                : realSpaces.map(space => {
                      const invite = boxInvites.get(space.id)
                      return invite ? { ...containerFromSpace(space), ...invite } : containerFromSpace(space)
                  }),
        [showPlaceholder, emptyOnboardingBoard, isSandbox, workspaceAccess, startingFirstAgent, placing, parkedTitle, realSpaces, boxInvites]
    )
    const containers = useMemo(() => (planPreview ? [...boardContainers, ...planPreview.containers] : boardContainers), [planPreview, boardContainers])

    const openBilling = useBillingStore(s => s.openBilling)
    const router = useRouter()
    const searchParams = useSearchParams()
    const resumePendingStart = useResumePendingStart()

    // Cliquer le placeholder = lancer le recrutement du premier agent (au lieu de le sélectionner).
    // Sous `md` le Foreman est une sheet : un tap sur le board la referme, sauf pendant le tunnel,
    // que le Foreman mène et qui ne doit pas se fermer sous le doigt.
    const dismissForemanSheet = useCallback(() => {
        if (!belowMd || guidedByForeman) return
        const foreman = useForemanStore.getState()
        if (foreman.open) foreman.close()
    }, [belowMd, guidedByForeman])
    const unseenGroups = useUnseenGroups()
    // A coworker with results opens on the newest one: opening it is what marks it read, and the
    // runs of the same scheduled task go with it.
    const handleTileSelect = useCallback(
        (id: string | null) => {
            dismissForemanSheet()
            const latest = id ? unseenGroups.find(group => group.agentId === id) : undefined
            if (!id || !latest) {
                selectAgent(id)
                return
            }
            const board = useBoardStore.getState()
            board.openAgentChat(id)
            board.setPendingOpenSession({ agentId: id, sessionId: latest.latestSessionId, runId: null })
            void useUnseenRunsStore.getState().markSeen(latest.sessionIds)
        },
        [dismissForemanSheet, selectAgent, unseenGroups]
    )

    const handleSelectSpace = useCallback(
        (id: string | null) => {
            dismissForemanSheet()
            // Un fantôme de l'aperçu n'a pas de panneau à ouvrir : la Box n'existe pas encore.
            if (isPlanPreviewId(id)) return
            if (id === PLACEHOLDER_ID) {
                if (startingFirstAgent || isSandbox) return
                // Template parkée (le paywall a été fermé) : reprendre la chaîne, sinon le wizard
                // l'écraserait et l'utilisateur n'aurait aucun retour.
                if (pendingTemplate) {
                    void resumePendingStart()
                    return
                }
                onRequestRecruitAgent?.()
                return
            }
            selectSpace(id)
            if (id && boxInvites.has(id)) onRequestBoxAgent?.(id)
        },
        [dismissForemanSheet, startingFirstAgent, isSandbox, pendingTemplate, resumePendingStart, onRequestRecruitAgent, selectSpace, boxInvites, onRequestBoxAgent]
    )

    // Le prompt tapé dans le composer du hero de la landing, `?prompt=<texte>` : il devient le premier
    // message de l'agent, et il est parké AVANT le signup, derrière le mur d'auth, parce que c'est ce
    // qui le fait survivre au retour de Google, qui perd la query string. Une fois le compte en place,
    // HomeContent rejoue le brouillon (markResume/consumeResume). Le nom, lui, est demandé au serveur,
    // parce qu'un agent baptisé avec les quatre premiers mots de la phrase se lit comme un bug ; le
    // composer du hero envoie celui qu'il a lu (`name`) et les apps avec (`apps`), et alors rien n'est
    // redemandé. Gardé
    // pour ne jamais écraser un workspace peuplé, ne jamais tourner deux fois, ni écraser un brouillon
    // déjà parké.
    //
    // Quand l'onboarding n'a pas été fait, la chaîne ne repart pas d'ici : le prompt décrit l'agent
    // voulu, pas encore l'équipe qui va avec. On pose le marqueur, et c'est le Foreman qui ouvre la
    // conversation dessus (readArrivingIntent → marqueur de kickoff).
    const heroPromptStarted = useRef(false)
    useEffect(() => {
        const prompt = searchParams.get('prompt')?.trim()
        if (!prompt || heroPromptStarted.current || !workspace || !showPlaceholder) return
        if (hasPendingStart(useOnboardingStore.getState())) return
        heroPromptStarted.current = true
        // Le sandbox n'a pas d'onboarding (useEnsureSandboxSpace lui pose son engine tout seul), donc
        // personne ne viendrait relever un marqueur posé là.
        const foremanTakesOver = !workspace.is_sandbox && !workspace.onboarded_at
        void (async () => {
            const name = readHeroAgentName(searchParams) ?? (await nameAgentFromPromptAction(prompt))
            router.replace('/')
            setPendingFirstAgent({ name, serviceSlugs: readHeroAgentApps(searchParams), kickoff: prompt })
            if (foremanTakesOver) {
                markFirstAgentFromPrompt()
                return
            }
            if (isAnonymous) return
            void resumePendingStart()
        })()
    }, [searchParams, workspace, showPlaceholder, isAnonymous, router, resumePendingStart, setPendingFirstAgent, markFirstAgentFromPrompt])

    // IsoGrid n'appelle onConfirmPlacement que sur un drop valide (dans un space, non occupé). Le
    // plan ne bloque plus rien ici : un agent posé sans slot libre est créé quand même, éteint, et
    // c'est board.store qui le dit.
    const handleConfirmPlacement = useCallback(
        async (pos: Parameters<typeof confirmPlacement>[0]) => {
            // Onboarding : le drop se fait sur le space fictif (placeholder), aucun engine réel
            // n'existe encore. On empile les tuiles, puis, la dernière posée, on parke le brouillon
            // (store + localStorage) et on ouvre le paywall — « hop » au lâcher. La création réelle
            // (claim space + agents + kickoff) se fait au retour de paiement, via HomeContent →
            // PostPaymentDialog → startPending, qui relit ce qui est parké. Rien n'est encore placé,
            // donc fermer le paywall (ou recharger) doit tout préserver : le nettoyage n'a lieu
            // qu'après création réelle (useStartPendingAgent / useStartPendingTemplate).
            if (placement && showPlaceholder) {
                // Une copie ne peut pas atterrir ici : sans Box réelle il n'y a aucun agent à
                // dupliquer. La branche existe pour que le switch reste exhaustif.
                if (placement.source.kind === 'duplicate') {
                    cancelPlacement()
                    return
                }

                const step = pushPlacement(pos, null)
                if (!step?.done) return

                // Les coordonnées sont relevées par rapport au coin du placeholder : le space que la
                // chaîne va réclamer ne vit pas aux mêmes colonnes.
                const offsets = step.positions.map(p => ({ col: p.col - PLACEHOLDER_CONTAINER.col_start, row: p.row - PLACEHOLDER_CONTAINER.row_start }))
                if (placement.source.kind === 'scratch') {
                    const draft = placement.source.draft
                    setPendingFirstAgent({ name: draft.name, description: draft.description, serviceSlugs: draft.serviceSlugs, kickoff: draft.kickoff, offset: offsets[0] })
                } else if (placement.source.kind === 'share') {
                    // Rien à parker de plus que le token : la fiche se recharge toute seule au retour
                    // et refait franchir la porte du placement, cette fois sur un vrai Space.
                    setPendingShareLink(placement.source.token)
                } else {
                    setPendingTemplate({ slug: placement.source.slug, title: placement.source.title, agentCount: placement.labels.length, offsets })
                }
                cancelPlacement()
                // Compte déjà payant sans Space (paiement passé, claim jamais fait) : rien à vendre,
                // on enchaîne directement sur la création.
                if (isSubscriptionEntitled(workspace?.subscription_status)) {
                    void resumePendingStart()
                    return
                }
                openBilling(undefined, 'iso_drop')
                return
            }
            confirmPlacement(pos)
        },
        [placement, showPlaceholder, workspace, resumePendingStart, openBilling, cancelPlacement, pushPlacement, setPendingFirstAgent, setPendingTemplate, setPendingShareLink, confirmPlacement]
    )

    const [claimTarget, setClaimTarget] = useState<ClaimSpaceTarget | null>(null)
    const [contextTarget, setContextTarget] = useState<BoardContextTarget | null>(null)

    // Props dérivées mémoïsées : sans ça, chaque update du store (statut agent, polling liveLinks…)
    // recrée ces tableaux/objets et force IsoGrid à tout recalculer même quand rien de visible ne change.
    //
    // Les tuiles déjà posées de la file : la formation se construit sous les yeux de l'utilisateur,
    // et IsoGrid les compte comme occupées, donc la suivante ne peut pas se poser dessus. Une tuile
    // disparaît dès que l'agent réel occupe son ancre (l'insert realtime la remplace).
    const attentionCounts = useMemo(() => attentionCountByAgent(sessions), [sessions])
    const nextRuns = useNextRuns()
    const resultsByAgent = useMemo(() => {
        const byAgent: Record<string, TileResults> = {}
        for (const group of unseenGroups) {
            const results = (byAgent[group.agentId] ??= { count: 0, items: [] })
            results.count += group.count
            results.items.push({ label: group.label, count: group.count, at: group.at })
        }
        return byAgent
    }, [unseenGroups])
    const boardTiles = useMemo(() => {
        const placed = agents.map(a => tileFromAgent(a, a.id === justPlacedAgentId, attentionCounts[a.id] ?? 0, workspaceAccess, nextRuns[a.id], resultsByAgent[a.id]))
        if (!placement) return placed

        const reserved = placement.placed
            .map((position, index) => ({ position, index }))
            .filter(({ position }) => !agents.some(a => a.position.col === position.col && a.position.row === position.row))
            .map(({ position, index }) => ({ id: `__reserved__${index}`, position, span: AGENT_SPAN, style: { ...agentTileStyle('idle', placement.labels[index]), opacity: 0.6 }, selectable: false, draggable: false }))
        return [...placed, ...reserved]
    }, [agents, attentionCounts, justPlacedAgentId, placement, workspaceAccess, nextRuns, resultsByAgent])
    const tiles = useMemo(() => (planPreview ? [...boardTiles, ...planPreview.tiles] : boardTiles), [planPreview, boardTiles])
    const computedLinks = useMemo(() => linksFromSessions(sessions, liveLinks), [sessions, liveLinks])
    const placingTile = useMemo(() => (placement ? { span: AGENT_SPAN, style: agentTileStyle('idle', placementLabel(placement)) } : undefined), [placement])

    const handleResizeCommit = useCallback(
        (id: string) => {
            const space = useBoardStore.getState().spaces.find(s => s.id === id)
            if (space) updateSpace(id, { col_start: space.col_start, col_end: space.col_end, row_start: space.row_start, row_end: space.row_end })
        },
        [updateSpace]
    )
    // Cadrage mémorisé par workspace. Le `key` sur IsoGrid est indispensable : changer de workspace
    // ne démonte pas la grille (HomeContent se contente de reset/rehydrater le board store), donc
    // sans remount le workspace B s'ouvrirait sur la caméra de A puis l'écraserait.
    const cameraScope = workspace ? `board:${workspace.id}` : null
    const initialCamera = useMemo(() => readCamera(cameraScope), [cameraScope])
    const handleCameraChange = useCallback(
        (camera: IsoCamera) => {
            if (cameraScope) writeCamera(cameraScope, camera)
        },
        [cameraScope]
    )
    // Bascule builder → dashboard : le démontage doit committer l'écriture encore en attente.
    useEffect(() => flushCamera, [])

    // Ajout d'une Box par une face d'une Box existante. Fermé pendant l'onboarding (le placeholder
    // n'est pas une vraie Box), en sandbox (la Box y est posée toute seule) et pendant un
    // placement d'agent, où le board est déjà en train de raconter autre chose.
    const canAddSpace = !!workspace && !isSandbox && !showPlaceholder && !placing && !previewing
    const handleContainerAdd = useCallback((spaceId: string, side: ContainerSide) => setClaimTarget({ spaceId, side }), [])
    const handleContainerAddPreview = useCallback(
        (spaceId: string, side: ContainerSide) => {
            const source = realSpaces.find(s => s.id === spaceId)
            return source ? freeRectOnSide(source, side, realSpaces) : null
        },
        [realSpaces]
    )
    // Above md the agent panel slides over the right edge of the board instead of pushing it, so a
    // tile centred on the whole canvas would land under it.
    const focusRequest = useMemo<IsoFocusRequest | null>(
        () => (cameraFocus ? { tileId: cameraFocus.agentId, nonce: cameraFocus.nonce, insetRight: belowMd ? 0 : loadSidePanelWidth(window.innerWidth) + SIDE_PANEL_GAP } : null),
        [cameraFocus, belowMd]
    )
    const handleTileContextMenu = useCallback((agentId: string) => setContextTarget({ kind: 'agent', id: agentId }), [])
    const handleContainerContextMenu = useCallback((spaceId: string) => setContextTarget({ kind: 'space', id: spaceId }), [])

    return (
        <>
            <BoardContextMenu target={contextTarget} onTargetClear={() => setContextTarget(null)}>
                <IsoGrid
                    key={cameraScope ?? 'anonymous'}
                    tiles={tiles}
                    containers={containers}
                    liveLinks={computedLinks}
                    mode={mode === 'space' ? 'draw' : 'select'}
                    selectedTileId={selectedAgentId}
                    selectedContainerId={selectedSpaceId}
                    paused={dialogCoversBoard || !windowFocused}
                    placingTileId={placingAgentId}
                    placing={placingFromQueue}
                    placingTile={placingTile}
                    placementContainerId={placement?.spaceId ?? (showPlaceholder ? PLACEHOLDER_ID : null)}
                    clampPlacementToContainer={showPlaceholder}
                    canDraw={!!workspace && !previewing}
                    drawColor={SPACE_COLOR}
                    showViewControls
                    viewControlsPlacement="top-right"
                    viewControlsClassName={guidedByForeman ? 'max-md:hidden' : undefined}
                    initialCamera={initialCamera}
                    recenterSignal={recenterSignal}
                    focusRequest={focusRequest}
                    onCameraChange={handleCameraChange}
                    onTileSelect={handleTileSelect}
                    onContainerSelect={handleSelectSpace}
                    onConfirmPlacement={handleConfirmPlacement}
                    onTileMove={moveAgent}
                    onResizeContainerLocal={previewing ? undefined : _localUpdateSpace}
                    onResizeContainerCommit={previewing ? undefined : handleResizeCommit}
                    onResizingContainerChange={previewing ? undefined : _setResizingSpaceId}
                    onContainerMove={showPlaceholder || previewing ? undefined : moveSpace}
                    onContainerAdd={canAddSpace ? handleContainerAdd : undefined}
                    containerAddPreview={canAddSpace ? handleContainerAddPreview : undefined}
                    containerAddLabel="Add a Box on this side"
                    onTileContextMenu={handleTileContextMenu}
                    onContainerContextMenu={showPlaceholder || previewing ? undefined : handleContainerContextMenu}
                    onPointerWorldMove={onPointerWorldMove}
                    worldOverlay={zoom => <CursorOverlay cursors={cursors} zoom={zoom} />}
                />
            </BoardContextMenu>

            <AnimatePresence>
                {showDiscoveries && discoveriesDomain && (
                    <motion.div key="discoveries" className="pointer-events-none absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
                        <BoardDiscoveries state={discoveries} domain={discoveriesDomain} compact={belowMd} />
                    </motion.div>
                )}
            </AnimatePresence>

            <ClaimSpaceDialog target={claimTarget} onClose={() => setClaimTarget(null)} />
        </>
    )
}
