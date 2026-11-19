'use client'

import { IsoGrid, SPACE_COLOR, agentTileStyle, type Container, type ContainerSide, type IsoCamera, type IsoFocusRequest, type TileResults } from '@moldwright/ui/iso-grid'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '@moldwright/ui/primitives/use-is-mobile'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type PlacementQueue, placementLabel, refuseUnmanagedBox, useBoardStore } from '@/stores/board.store'
import { useBoardCoverStore } from '@/stores/board-cover.store'
import { useForemanStore } from '@/stores/foreman.store'
import { useBillingStore } from '@/stores/billing.store'
import { hasPendingStart, useOnboardingStore } from '@/stores/onboarding.store'
import { isSubscriptionEntitled } from '@moldwright/cloud/billing'
import { readHeroAgentApps, readHeroAgentName } from '@/lib/onboarding/hero-handoff'
import { useResumePendingStart } from '@/lib/onboarding/useResumePendingStart'
import { routes } from '@/lib/routes'
import { nameAgentFromPromptAction } from '@/app/api/_actions/onboarding.actions'
import { useSession } from '@/supabase/session/SessionProvider'
import { BOX_FIRST_INTRO, ClaimSpaceDialog, type ClaimSpaceTarget } from '@/components/dialogs/ClaimSpaceDialog'
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
import { useBoxViewer, useManageableSpaceIds } from '@/hooks/useBoxAccess'
import { boxContainerFor, boxTileFor, emptyBoardOffersBox, placementNeedsBoxFirst } from '@/lib/board/box-controls'
import { flushCamera, readCamera, writeCamera } from '@/lib/camera-storage'
import { attentionCountByAgent } from '@/lib/board/attention'
import { useNextRuns } from '@/hooks/useNextRuns'
import { useUnseenGroups } from '@/hooks/useUnseenGroups'
import { useUnseenRunsStore } from '@/stores/unseen-runs.store'
import { containerFromSpace, linksFromSessions, tileFromAgent } from '@/lib/board/iso-adapter'
import { useKitTranslations } from '@moldwright/ui/locale'
import { useAgentIdeas } from '@/lib/agent-ideas/useAgentIdeas'
import { boxCtaExamples, boxCtaLabel } from '@/lib/onboarding/box-themes'
import { localizeSuggestion } from '@/lib/onboarding/localize-suggestion'
import { useOnboardingIndustry } from '@/lib/onboarding/useOnboardingIndustry'
import { AGENT_SPAN } from '@/lib/board/iso'
import { freeRectOnSide } from '@/lib/board/space-layout'
import { SIDE_PANEL_GAP, loadSidePanelWidth } from '@/lib/side-panel-width'
import type { SpacePublic } from '@/lib/board/types'


const PLACEHOLDER_ID = '__placeholder__'

const PLACEHOLDER_CONTAINER: Container = { id: PLACEHOLDER_ID, label: null, color: SPACE_COLOR, col_start: 2, row_start: 2, col_end: 9, row_end: 9, variant: 'placeholder' }
const MEMBER_PLACEHOLDER_CONTAINER: Container = { ...PLACEHOLDER_CONTAINER, readOnly: true }

const PANEL_SHEET_QUERY = '(max-width: 767.98px)'

function clampLabel(title: string): string {
    return title.length > 24 ? `${title.slice(0, 23)}…` : title
}

export function IsoBoard({ onRequestRecruitAgent, onRequestBoxAgent, initialSpaces = [] }: { onRequestRecruitAgent?: () => void; onRequestBoxAgent?: (spaceId: string) => void; initialSpaces?: SpacePublic[] }) {
    const t = useTranslations('builder.isoBoard')
    const tKit = useKitTranslations()
    const tErrors = useTranslations('errors')
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
    const recenterBoard = useBoardStore(s => s.recenterBoard)
    const viewer = useBoxViewer()
    const manageableSpaceIds = useManageableSpaceIds()

    const useServerData = !hydrated
    const realSpaces = useServerData ? initialSpaces : spaces

    const showPlaceholder = realSpaces.length === 0
    const memberWithoutBox = emptyBoardOffersBox(viewer.role, realSpaces.length)
    const [ownBoxOpen, setOwnBoxOpen] = useState(false)
    const placingFromQueue = !!placement && !placement.installing
    const placing = placingFromQueue || !!placingAgentId
    const isSandbox = workspace?.is_sandbox === true
    const parkedTitle = pendingTemplate ? clampLabel(pendingTemplate.title) : null
    const guidedByForeman = foremanFunnel === 'guided' || (foremanFunnel === 'unknown' && !workspace?.onboarded_at)
    const installedFirst = useForemanStore(s => s.arrival?.installed === true)
    const emptyOnboardingBoard = !memberWithoutBox && !isSandbox && guidedByForeman && !startingFirstAgent && !placing && !parkedTitle && !installedFirst
    const discoveries = useDiscoveriesStore(s => s.state)
    const discoveriesDomain = useDiscoveriesStore(s => s.domain)
    const intakeOpen = useForemanStore(s => s.intake)
    useCompanyDiscoveries(emptyOnboardingBoard && !isAnonymous && !intakeOpen)
    const showDiscoveries = emptyOnboardingBoard && !!discoveriesDomain && discoveries.entries.length > 0
    const builtRects = useMemo(() => realSpaces.map(space => ({ col_start: space.col_start, row_start: space.row_start, col_end: space.col_end, row_end: space.row_end })), [realSpaces])
    const planPreview = usePlanPreviewScene(emptyOnboardingBoard, builtRects)
    const previewing = !!planPreview

    const agentIdeas = useAgentIdeas()
    const industry = useOnboardingIndustry()
    const tSuggestions = useTranslations('agentSuggestions')
    const invitesAgents = hydrated && !!workspace && !isSandbox && !isAnonymous && !needsMachineReason && !guidedByForeman && !startingFirstAgent && !placement && !placingAgentId && !previewing && mode !== 'space'
    const boxInvites = useMemo(() => {
        const invites = new Map<string, Pick<Container, 'cta' | 'ctaExamples'>>()
        if (!invitesAgents) return invites
        const agentNames = agents.map(a => a.name)
        for (const space of realSpaces) {
            if (agents.some(a => a.spaceId === space.id)) continue
            invites.set(space.id, {
                cta: boxCtaLabel(space.name, t),
                ctaExamples: boxCtaExamples({ boxName: space.name, industry, ideas: agentIdeas, agentNames }, suggestion => localizeSuggestion(suggestion, tSuggestions)),
            })
        }
        return invites
    }, [invitesAgents, agents, realSpaces, agentIdeas, industry, t, tSuggestions])

    const boardContainers = useMemo<Container[]>(
        () =>
            showPlaceholder
                ? emptyOnboardingBoard
                    ? []
                    : [
                          isSandbox
                              ? workspaceAccess === 'paused'
                                  ? { ...PLACEHOLDER_CONTAINER, variant: 'default' as const, placeholderLabel: undefined }
                                  : { ...PLACEHOLDER_CONTAINER, variant: 'loading' as const, placeholderLabel: t('preparingSandbox') }
                              : startingFirstAgent
                                ? { ...PLACEHOLDER_CONTAINER, variant: 'loading' as const, placeholderLabel: parkedTitle ? t('settingUpTemplate', { title: parkedTitle }) : t('settingUpCoworker') }
                                : placing
                                  ? { ...PLACEHOLDER_CONTAINER, variant: 'default' as const, placeholderLabel: undefined, readOnly: memberWithoutBox }
                                  : parkedTitle
                                    ? { ...PLACEHOLDER_CONTAINER, placeholderLabel: t('installTemplate', { title: parkedTitle }) }
                                    : memberWithoutBox
                                      ? { ...MEMBER_PLACEHOLDER_CONTAINER, placeholderLabel: t('createBox') }
                                      : { ...PLACEHOLDER_CONTAINER, placeholderLabel: t('recruitFirst') },
                      ]
                : realSpaces.map(space => {
                      const invite = boxInvites.get(space.id)
                      return boxContainerFor(invite ? { ...containerFromSpace(space, tKit), ...invite } : containerFromSpace(space, tKit), manageableSpaceIds.has(space.id), tErrors('boxManagerOnly'))
                  }),
        [showPlaceholder, emptyOnboardingBoard, isSandbox, workspaceAccess, startingFirstAgent, placing, parkedTitle, memberWithoutBox, realSpaces, boxInvites, manageableSpaceIds, t, tKit, tErrors]
    )
    const containers = useMemo(() => (planPreview ? [...boardContainers, ...planPreview.containers] : boardContainers), [planPreview, boardContainers])

    const openBilling = useBillingStore(s => s.openBilling)
    const router = useRouter()
    const searchParams = useSearchParams()
    const resumePendingStart = useResumePendingStart()

    const dismissForemanSheet = useCallback(() => {
        if (!belowMd || guidedByForeman) return
        const foreman = useForemanStore.getState()
        if (foreman.open) foreman.close()
    }, [belowMd, guidedByForeman])
    const unseenGroups = useUnseenGroups()
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
            if (isPlanPreviewId(id)) return
            if (id === PLACEHOLDER_ID) {
                if (startingFirstAgent || isSandbox) return
                if (pendingTemplate) {
                    void resumePendingStart()
                    return
                }
                if (memberWithoutBox) {
                    setOwnBoxOpen(true)
                    return
                }
                onRequestRecruitAgent?.()
                return
            }
            selectSpace(id)
            if (id && boxInvites.has(id) && manageableSpaceIds.has(id)) onRequestBoxAgent?.(id)
        },
        [dismissForemanSheet, startingFirstAgent, isSandbox, pendingTemplate, resumePendingStart, memberWithoutBox, onRequestRecruitAgent, selectSpace, boxInvites, manageableSpaceIds, onRequestBoxAgent]
    )

    const heroPromptStarted = useRef(false)
    useEffect(() => {
        const prompt = searchParams.get('prompt')?.trim()
        if (!prompt || heroPromptStarted.current || !workspace || !showPlaceholder) return
        if (hasPendingStart(useOnboardingStore.getState())) return
        heroPromptStarted.current = true
        const foremanTakesOver = !workspace.is_sandbox && !workspace.onboarded_at
        void (async () => {
            const name = readHeroAgentName(searchParams) ?? (await nameAgentFromPromptAction(prompt))
            router.replace(routes.board)
            setPendingFirstAgent({ name, serviceSlugs: readHeroAgentApps(searchParams), kickoff: prompt })
            if (foremanTakesOver) {
                markFirstAgentFromPrompt()
                return
            }
            if (isAnonymous) return
            void resumePendingStart()
        })()
    }, [searchParams, workspace, showPlaceholder, isAnonymous, router, resumePendingStart, setPendingFirstAgent, markFirstAgentFromPrompt])

    const handleConfirmPlacement = useCallback(
        async (pos: Parameters<typeof confirmPlacement>[0]) => {
            if (placement && showPlaceholder) {
                if (memberWithoutBox) return
                if (placement.source.kind === 'duplicate') {
                    cancelPlacement()
                    return
                }

                const step = pushPlacement(pos, null)
                if (!step?.done) return

                const offsets = step.positions.map(p => ({ col: p.col - PLACEHOLDER_CONTAINER.col_start, row: p.row - PLACEHOLDER_CONTAINER.row_start }))
                if (placement.source.kind === 'scratch') {
                    const draft = placement.source.draft
                    setPendingFirstAgent({ name: draft.name, description: draft.description, serviceSlugs: draft.serviceSlugs, kickoff: draft.kickoff, offset: offsets[0] })
                } else if (placement.source.kind === 'share') {
                    setPendingShareLink(placement.source.token)
                } else {
                    setPendingTemplate({ slug: placement.source.slug, title: placement.source.title, agentCount: placement.labels.length, offsets })
                }
                cancelPlacement()
                if (isSubscriptionEntitled(workspace?.subscription_status)) {
                    void resumePendingStart()
                    return
                }
                openBilling(undefined, 'iso_drop')
                return
            }
            confirmPlacement(pos, viewer)
        },
        [placement, showPlaceholder, memberWithoutBox, workspace, resumePendingStart, openBilling, cancelPlacement, pushPlacement, setPendingFirstAgent, setPendingTemplate, setPendingShareLink, confirmPlacement, viewer]
    )

    const handleTileMove = useCallback((id: string, pos: Parameters<typeof moveAgent>[1], containerId?: string) => moveAgent(id, pos, containerId, viewer), [moveAgent, viewer])
    const handleTileMoveRefused = useCallback((id: string) => {
        if (useBoardStore.getState().agents.some(a => a.id === id)) refuseUnmanagedBox()
    }, [])
    const handleContainerMove = useCallback((id: string, rect: Parameters<typeof moveSpace>[1]) => moveSpace(id, rect, viewer), [moveSpace, viewer])

    const [boxNamedFor, setBoxNamedFor] = useState<PlacementQueue | null>(null)
    const needsBoxFirst = hydrated && placementNeedsBoxFirst({ placing: placingFromQueue, role: viewer.role, manageableSpaceCount: manageableSpaceIds.size })
    const boxFirstOpen = needsBoxFirst && boxNamedFor !== placement
    const namedBoxArrived = !!placement && boxNamedFor === placement && manageableSpaceIds.size > 0
    useEffect(() => {
        if (namedBoxArrived) recenterBoard()
    }, [namedBoxArrived, recenterBoard])

    const [claimTarget, setClaimTarget] = useState<ClaimSpaceTarget | null>(null)
    const [contextTarget, setContextTarget] = useState<BoardContextTarget | null>(null)

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
        const placed = agents.map(a => boxTileFor(tileFromAgent(a, a.id === justPlacedAgentId, attentionCounts[a.id] ?? 0, workspaceAccess, nextRuns[a.id], resultsByAgent[a.id], tKit), manageableSpaceIds.has(a.spaceId)))
        if (!placement) return placed

        const reserved = placement.placed
            .map((position, index) => ({ position, index }))
            .filter(({ position }) => !agents.some(a => a.position.col === position.col && a.position.row === position.row))
            .map(({ position, index }) => ({ id: `__reserved__${index}`, position, span: AGENT_SPAN, style: { ...agentTileStyle('idle', placement.labels[index]), opacity: 0.6 }, selectable: false, draggable: false }))
        return [...placed, ...reserved]
    }, [agents, attentionCounts, justPlacedAgentId, placement, workspaceAccess, nextRuns, resultsByAgent, manageableSpaceIds, tKit])
    const tiles = useMemo(() => (planPreview ? [...boardTiles, ...planPreview.tiles] : boardTiles), [planPreview, boardTiles])
    const computedLinks = useMemo(() => linksFromSessions(sessions, liveLinks), [sessions, liveLinks])
    const placingTile = useMemo(() => (placement ? { span: AGENT_SPAN, style: agentTileStyle('idle', placementLabel(placement)) } : undefined), [placement])

    const handleResizeCommit = useCallback(
        (id: string) => {
            const space = useBoardStore.getState().spaces.find(s => s.id === id)
            if (space) updateSpace(id, { col_start: space.col_start, col_end: space.col_end, row_start: space.row_start, row_end: space.row_end }, viewer)
        },
        [updateSpace, viewer]
    )
    const cameraScope = workspace ? `board:${workspace.id}` : null
    const initialCamera = useMemo(() => readCamera(cameraScope), [cameraScope])
    const handleCameraChange = useCallback(
        (camera: IsoCamera) => {
            if (cameraScope) writeCamera(cameraScope, camera)
        },
        [cameraScope]
    )
    useEffect(() => flushCamera, [])

    const canAddSpace = !!workspace && !isSandbox && !showPlaceholder && !placing && !previewing
    const handleContainerAdd = useCallback((spaceId: string, side: ContainerSide) => setClaimTarget({ spaceId, side }), [])
    const handleContainerAddPreview = useCallback(
        (spaceId: string, side: ContainerSide) => {
            const source = realSpaces.find(s => s.id === spaceId)
            return source ? freeRectOnSide(source, side, realSpaces) : null
        },
        [realSpaces]
    )
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
                    fitToContent={viewer.role === 'member'}
                    recenterSignal={recenterSignal}
                    focusRequest={focusRequest}
                    onCameraChange={handleCameraChange}
                    onTileSelect={handleTileSelect}
                    onContainerSelect={handleSelectSpace}
                    onConfirmPlacement={handleConfirmPlacement}
                    onTileMove={handleTileMove}
                    onTileMoveRefused={handleTileMoveRefused}
                    onResizeContainerLocal={previewing ? undefined : _localUpdateSpace}
                    onResizeContainerCommit={previewing ? undefined : handleResizeCommit}
                    onResizingContainerChange={previewing ? undefined : _setResizingSpaceId}
                    onContainerMove={showPlaceholder || previewing ? undefined : handleContainerMove}
                    onContainerAdd={canAddSpace ? handleContainerAdd : undefined}
                    containerAddPreview={canAddSpace ? handleContainerAddPreview : undefined}
                    containerAddLabel={t('addBoxOnSide')}
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
            <ClaimSpaceDialog
                target={null}
                open={boxFirstOpen || ownBoxOpen}
                intro={boxFirstOpen ? BOX_FIRST_INTRO : undefined}
                onCreated={() => {
                    setOwnBoxOpen(false)
                    if (boxFirstOpen) setBoxNamedFor(placement)
                }}
                onClose={() => {
                    setOwnBoxOpen(false)
                    if (boxFirstOpen) cancelPlacement()
                }}
            />
        </>
    )
}
