'use client'

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { CONTAINER_SIDES, DEFAULT_SPAN, DIAMOND, GRID_SIZE, MIN_CONTAINER_SPAN, TILE_H, TILE_W, clampAnchorToRange, containerCellRange, containerContainsTile, isPlaced, isoPosition, resizedContainerRect, screenToGrid, tileCoversCell, tileTopLift, tileZ, tilesOverlap } from './iso'
import type { Container, ContainerCellRect, ContainerHandle, ContainerSide, FrameInset, IsoCamera, IsoFocusRequest, IsoGridProps, Tile, TileLink, TileToast } from './types'
import { TileBlock } from './components/TileBlock'
import { TileResultsCard } from './components/TileResultsCard'
import { TileStatusBubble } from './components/TileStatusBubble'
import { TileToastBubble } from './components/TileToastBubble'
import { TileLinks } from './components/TileLinks'
import { BeamRing } from './components/BeamRing'
import { DROP_REFUSAL_MS, DropHint } from './components/DropHint'
import { ContainerBlock } from './components/ContainerBlock'
import { ContainerDrawPreview } from './components/ContainerDrawPreview'
import { ContainerAddHandles } from './components/ContainerAddHandles'
import { useTouchGestures } from './hooks/useTouchGestures'
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion'
import { useOnScreen } from './hooks/useOnScreen'
import { CanvasViewControls } from '../CanvasViewControls'
import { useTransientTransition } from '../useTransientTransition'
import { useKitTranslations } from '../locale'

const DEFAULT_MASK = 'radial-gradient(ellipse 70% 70% at 50% 50%, black 60%, transparent 100%)'
const DEFAULT_DRAW_COLOR = '#3b82f6'

const DRAG_THRESHOLD_PX = 4

const CENTER_ISO = isoPosition(GRID_SIZE / 2, GRID_SIZE / 2)
const WORLD_OFFSET = { left: -CENTER_ISO.left, top: -CENTER_ISO.top }

const NO_LINKS: TileLink[] = []
const NO_TOASTS: TileToast[] = []

const CAMERA_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const DEFAULT_CAMERA_TRANSITION_MS = 620

const SVG_HALF_W = Math.ceil(5000 / TILE_W) * TILE_W
const SVG_HALF_H = Math.ceil(3000 / TILE_H) * TILE_H

const FLOOR_LINE_PX = 0.9
const FLOOR_LINE_MIN = 0.5

const RECENTER_PADDING = TILE_W * 2
const NO_INSET: FrameInset = { left: 0, right: 0 }
const FIT_PADDING = TILE_W / 2

const NAV_MARGIN_X = 6 * TILE_W
const NAV_MARGIN_Y = 6 * TILE_H
const MIN_HALF_W = 1500
const MIN_HALF_H = 900

function tileBox(col: number, row: number, span: number, worldOffset: { left: number; top: number }) {
    const p = isoPosition(col, row)
    return { left: p.left - (span * TILE_W - TILE_W) / 2 + worldOffset.left, top: p.top + worldOffset.top, width: span * TILE_W, height: span * TILE_H }
}

function tileUnderPoint(tiles: Tile[], x: number, y: number) {
    let hit: Tile | undefined
    for (const tile of tiles) {
        if (!isPlaced(tile.position)) continue
        const span = spanOf(tile)
        const lift = tileTopLift(tile.style, span)
        const covered = [0, lift / 2, lift].some(rise => {
            const cell = screenToGrid(x, y + rise)
            return tileCoversCell(tile.position.col, tile.position.row, cell.col, cell.row, span)
        })
        if (covered && (!hit || tileZ(tile.position.col, tile.position.row, span) > tileZ(hit.position.col, hit.position.row, spanOf(hit)))) hit = tile
    }
    return hit
}

type WorldBox = { left: number; right: number; top: number; bottom: number }

function contentWorldBox(tiles: Tile[], containers: Container[], worldOffset: { left: number; top: number }): WorldBox | null {
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    for (const t of tiles) {
        const b = tileBox(t.position.col, t.position.row, spanOf(t), worldOffset)
        left = Math.min(left, b.left)
        right = Math.max(right, b.left + b.width)
        top = Math.min(top, b.top - tileTopLift(t.style, spanOf(t)))
        bottom = Math.max(bottom, b.top + b.height)
    }
    for (const c of containers) {
        const colMin = Math.min(c.col_start, c.col_end)
        const colMax = Math.max(c.col_start, c.col_end)
        const rowMin = Math.min(c.row_start, c.row_end)
        const rowMax = Math.max(c.row_start, c.row_end)
        left = Math.min(left, isoPosition(colMin, rowMax + 1).left + TILE_W / 2 + worldOffset.left)
        right = Math.max(right, isoPosition(colMax + 1, rowMin).left + TILE_W / 2 + worldOffset.left)
        top = Math.min(top, isoPosition(colMin, rowMin).top + worldOffset.top)
        bottom = Math.max(bottom, isoPosition(colMax + 1, rowMax + 1).top + worldOffset.top)
    }
    if (!Number.isFinite(left)) return null
    return { left, right, top, bottom }
}

function fitCamera(box: WorldBox, frame: { width: number; height: number }, maxZoom: number, pad = RECENTER_PADDING, inset: FrameInset = NO_INSET) {
    const covered = inset.left + inset.right < frame.width * 0.75 ? inset : NO_INSET
    const width = frame.width - covered.left - covered.right
    const zoom = Math.min(maxZoom, Math.max(0.3, Math.min(width / (box.right - box.left + pad * 2), frame.height / (box.bottom - box.top + pad * 2))))
    return { zoom, pan: { x: -(box.left + box.right) / 2 + (covered.left - covered.right) / 2 / zoom, y: -(box.top + box.bottom) / 2 } }
}

function containerContainsCell(c: Container, cell: { col: number; row: number }, margin = 0) {
    const colMin = Math.min(c.col_start, c.col_end) - margin
    const colMax = Math.max(c.col_start, c.col_end) + margin
    const rowMin = Math.min(c.row_start, c.row_end) - margin
    const rowMax = Math.max(c.row_start, c.row_end) + margin
    return cell.col >= colMin && cell.col <= colMax && cell.row >= rowMin && cell.row <= rowMax
}

const ADD_HALO = 2

function handleAtCell(c: Container, cell: { col: number; row: number }): ContainerHandle | null {
    const colStart = Math.min(c.col_start, c.col_end)
    const colEnd = Math.max(c.col_start, c.col_end)
    const rowStart = Math.min(c.row_start, c.row_end)
    const rowEnd = Math.max(c.row_start, c.row_end)

    if (cell.col === colStart && cell.row === rowStart) return 'top'
    if (cell.col === colEnd && cell.row === rowStart) return 'right'
    if (cell.col === colEnd && cell.row === rowEnd) return 'bottom'
    if (cell.col === colStart && cell.row === rowEnd) return 'left'
    return null
}

const spanOf = (t: Tile) => t.span ?? DEFAULT_SPAN

function layoutBox(container: HTMLElement) {
    return { width: container.offsetWidth, height: container.offsetHeight }
}

type Cell = { col: number; row: number }
type CellRange = ReturnType<typeof containerCellRange>

const INVALID_DROP_COLOR = '#ef4444'
const SETTLE_MS = 200

const movable = (c: Container) => c.variant !== 'placeholder' && c.variant !== 'loading'
const rangesOverlap = (a: CellRange, b: CellRange) => a.colMin <= b.colMax && b.colMin <= a.colMax && a.rowMin <= b.rowMax && b.rowMin <= a.rowMax
const tileRange = (t: Tile): CellRange => ({ colMin: t.position.col, colMax: t.position.col + spanOf(t) - 1, rowMin: t.position.row, rowMax: t.position.row + spanOf(t) - 1 })

function shiftedRect(c: ContainerCellRect, delta: Cell): ContainerCellRect {
    return { col_start: c.col_start + delta.col, col_end: c.col_end + delta.col, row_start: c.row_start + delta.row, row_end: c.row_end + delta.row }
}

export const IsoGrid = memo(function IsoGrid(props: IsoGridProps) {
    const t = useKitTranslations()
    const {
        tiles,
        containers,
        liveLinks = NO_LINKS,
        toasts = NO_TOASTS,
        selectedTileId = null,
        selectedContainerId = null,
        placingTileId = null,
        placing = false,
        placingTile,
        placementContainerId = null,
        clampPlacementToContainer = false,
        mode = 'select',
        showLinks,
        worldAnchor = { left: '50%', top: '50%' },
        initialPan = { x: 0, y: 0 },
        initialZoomDesktop = 1.8,
        initialZoomMobile = 1.0,
        initialCamera = null,
        camera = null,
        cameraTransitionMs = DEFAULT_CAMERA_TRANSITION_MS,
        fitToContent = false,
        recenterSignal,
        frameInset = NO_INSET,
        focusRequest = null,
        mask = DEFAULT_MASK,
        drawColor = DEFAULT_DRAW_COLOR,
        canDraw = true,
        className,
        paused = false,
        scrollGestures = true,
        locked = false,
        showViewControls = false,
        viewControlsPlacement = 'bottom-right',
        viewControlsClassName,
        onTileSelect,
        onContainerSelect,
        onConfirmPlacement,
        onTileMove,
        onTileMoveRefused,
        canDropTile,
        onTileContextMenu,
        onResizeContainerLocal,
        onResizeContainerCommit,
        onResizingContainerChange,
        onContainerMove,
        onCreateContainerRequest,
        onContainerAdd,
        containerAddPreview,
        containerAddLabel,
        onContainerContextMenu,
        onCameraChange,
        onToastExpire,
        onPointerWorldMove,
        worldOverlay,
    } = props

    const interactive = !!(onTileSelect || onContainerSelect || onTileMove || onConfirmPlacement || onCreateContainerRequest || onContainerAdd || onContainerContextMenu || onTileContextMenu || onResizeContainerLocal || onContainerMove)

    const gestures = scrollGestures && !locked

    const reducedMotion = usePrefersReducedMotion()

    const placementActive = !!placingTileId || placing

    const placementTargets = useMemo(() => containers.filter(c => !c.readOnly && (!placementContainerId || c.id === placementContainerId)), [placementContainerId, containers])

    const placingTileObj = placingTileId ? tiles.find(t => t.id === placingTileId) : undefined
    const placeSpan = placingTileObj ? spanOf(placingTileObj) : placingTile?.span ?? DEFAULT_SPAN
    const placeStyle = placingTileObj?.style ?? placingTile?.style ?? { color: 'var(--iso-tile-muted)' }

    const containerRef = useRef<HTMLDivElement>(null)
    const onScreen = useOnScreen(containerRef)
    const [zoom, setZoom] = useState(() => camera?.zoom ?? initialCamera?.zoom ?? initialZoomDesktop)
    const zoomRef = useRef(zoom)
    zoomRef.current = zoom
    const [pan, setPan] = useState(() => camera?.pan ?? initialCamera?.pan ?? initialPan)

    const restoredRef = useRef(!!initialCamera || !!camera)
    const restorePendingRef = useRef(!!initialCamera || !!camera)
    const userFramedRef = useRef(false)
    const requestedCameraRef = useRef<IsoCamera | null>(camera)
    const pushedCameraRef = useRef<IsoCamera | null>(null)
    const { animating, durationMs: transitionMs, animate, cancel: cancelAnim } = useTransientTransition()
    const [hoverCell, setHoverCell] = useState<{ col: number; row: number } | null>(null)
    const [hoverTileId, setHoverTileId] = useState<string | null>(null)
    const [hoverContainerId, setHoverContainerId] = useState<string | null>(null)
    const [addSide, setAddSide] = useState<{ containerId: string; side: ContainerSide } | null>(null)
    const overAddHandleRef = useRef(false)
    const [isPanning, setIsPanning] = useState(false)
    const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

    const [dragState, setDragState] = useState<{ tileId: string; startPos: { col: number; row: number }; span: number; containerId: string | null } | null>(null)
    const [dragGhostCell, setDragGhostCell] = useState<{ col: number; row: number } | null>(null)
    const [refusal, setRefusal] = useState<{ cell: { col: number; row: number }; span: number; reason: string } | null>(null)
    const refusalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const clearRefusal = useCallback(() => {
        if (refusalTimerRef.current) clearTimeout(refusalTimerRef.current)
        refusalTimerRef.current = null
        setRefusal(null)
    }, [])
    useEffect(
        () => () => {
            if (refusalTimerRef.current) clearTimeout(refusalTimerRef.current)
        },
        []
    )

    const pendingDragRef = useRef<{ tileId: string; startPos: { col: number; row: number }; span: number; containerId: string | null; origin: { x: number; y: number }; select: boolean; refused?: boolean } | null>(null)

    const [boxDrag, setBoxDrag] = useState<{ containerId: string; grab: Cell; delta: Cell } | null>(null)
    const pendingBoxDragRef = useRef<{ containerId: string; grab: Cell; origin: { x: number; y: number } } | null>(null)
    const touchGrabRef = useRef<{ containerId: string; grab: Cell } | null>(null)
    const [hoverGripId, setHoverGripId] = useState<string | null>(null)
    const [settlingContainerId, setSettlingContainerId] = useState<string | null>(null)
    const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const [holdPoint, setHoldPoint] = useState<{ x: number; y: number } | null>(null)

    const handleAddSideHover = useCallback((containerId: string, side: ContainerSide | null) => {
        overAddHandleRef.current = side !== null
        setAddSide(side ? { containerId, side } : null)
    }, [])

    const addSidesByContainer = useMemo(() => {
        const map = new Map<string, readonly ContainerSide[]>()
        for (const id of new Set([hoverContainerId, selectedContainerId])) {
            if (!id) continue
            map.set(id, containerAddPreview ? CONTAINER_SIDES.filter(side => containerAddPreview(id, side)) : CONTAINER_SIDES)
        }
        return map
    }, [hoverContainerId, selectedContainerId, containerAddPreview])

    const handleContainerAdd = useCallback(
        (containerId: string, side: ContainerSide) => {
            overAddHandleRef.current = false
            setAddSide(null)
            setHoverContainerId(null)
            onContainerAdd?.(containerId, side)
        },
        [onContainerAdd]
    )

    const [drawStart, setDrawStart] = useState<{ col: number; row: number } | null>(null)
    const [drawEnd, setDrawEnd] = useState<{ col: number; row: number } | null>(null)

    const [resizeState, setResizeState] = useState<{ containerId: string; handle: ContainerHandle } | null>(null)
    const [hoverHandle, setHoverHandle] = useState<ContainerHandle | null>(null)

    useEffect(() => {
        if (restoredRef.current || fitToContent) return
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
            setZoom(initialZoomMobile)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const anchorFrac = useMemo(
        () => ({
            x: (parseFloat(worldAnchor.left) || 0) / 100,
            y: (parseFloat(worldAnchor.top) || 0) / 100,
        }),
        [worldAnchor.left, worldAnchor.top]
    )

    const anchorFracRef = useRef(anchorFrac)
    anchorFracRef.current = anchorFrac

    const placedTiles = useMemo(() => tiles.filter(t => isPlaced(t.position)), [tiles])

    const contentBox = useMemo(() => contentWorldBox(placedTiles, containers, WORLD_OFFSET), [placedTiles, containers])
    const panBounds = useMemo<WorldBox>(() => {
        if (!showViewControls) return { left: -SVG_HALF_W, right: SVG_HALF_W, top: -SVG_HALF_H, bottom: SVG_HALF_H }
        const b = contentBox ?? { left: 0, right: 0, top: 0, bottom: 0 }
        return {
            left: Math.min(b.left - NAV_MARGIN_X, -MIN_HALF_W),
            right: Math.max(b.right + NAV_MARGIN_X, MIN_HALF_W),
            top: Math.min(b.top - NAV_MARGIN_Y, -MIN_HALF_H),
            bottom: Math.max(b.bottom + NAV_MARGIN_Y, MIN_HALF_H),
        }
    }, [showViewControls, contentBox])

    const contentBoxRef = useRef(contentBox)
    contentBoxRef.current = contentBox
    const panBoundsRef = useRef(panBounds)
    panBoundsRef.current = panBounds

    const clampPan = useCallback((p: { x: number; y: number }, z: number) => {
        const container = containerRef.current
        if (!container) return p
        const rect = container.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return p
        const af = anchorFracRef.current
        const anchorX = rect.width * af.x
        const anchorY = rect.height * af.y
        const b = panBoundsRef.current
        const maxX = -anchorX / z - b.left
        const minX = (rect.width - anchorX) / z - b.right
        const maxY = -anchorY / z - b.top
        const minY = (rect.height - anchorY) / z - b.bottom
        const clampAxis = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)))
        return { x: clampAxis(p.x, minX, maxX), y: clampAxis(p.y, minY, maxY) }
    }, [])

    const getGameCoords = useCallback(
        (clientX: number, clientY: number) => {
            const container = containerRef.current
            if (!container) return null
            const rect = container.getBoundingClientRect()
            const cx = rect.width * anchorFrac.x
            const cy = rect.height * anchorFrac.y

            const mouseX = clientX - rect.left
            const mouseY = clientY - rect.top

            const scale = container.offsetWidth > 0 ? rect.width / container.offsetWidth : 1

            const worldX = (mouseX - cx) / (zoom * scale) - pan.x
            const worldY = (mouseY - cy) / (zoom * scale) - pan.y

            const centerIso = isoPosition(GRID_SIZE / 2, GRID_SIZE / 2)
            return { gameX: worldX + centerIso.left, gameY: worldY + centerIso.top }
        },
        [zoom, pan, anchorFrac]
    )

    const getGridCoordsFromClient = useCallback(
        (clientX: number, clientY: number) => {
            const g = getGameCoords(clientX, clientY)
            if (!g) return null
            return screenToGrid(g.gameX - TILE_W / 2, g.gameY)
        },
        [getGameCoords]
    )

    const getTileFromClient = useCallback(
        (clientX: number, clientY: number, candidates: Tile[]) => {
            const g = getGameCoords(clientX, clientY)
            if (!g) return undefined
            return tileUnderPoint(candidates, g.gameX - TILE_W / 2, g.gameY)
        },
        [getGameCoords]
    )

    const getWorldCoords = useCallback(
        (clientX: number, clientY: number) => {
            const g = getGameCoords(clientX, clientY)
            if (!g) return null
            return { x: g.gameX - CENTER_ISO.left, y: g.gameY - CENTER_ISO.top }
        },
        [getGameCoords]
    )

    const getTileAnchorFromClient = useCallback(
        (clientX: number, clientY: number, span = DEFAULT_SPAN) => {
            const g = getGameCoords(clientX, clientY)
            if (!g) return null
            return screenToGrid(g.gameX - TILE_W / 2, g.gameY - ((span - 1) * TILE_H) / 2)
        },
        [getGameCoords]
    )

    const getGridCoords = useCallback((e: React.MouseEvent | MouseEvent) => getGridCoordsFromClient(e.clientX, e.clientY), [getGridCoordsFromClient])

    const dropFor = useCallback(
        (containerId: string, delta: Cell) => {
            const source = containers.find(c => c.id === containerId)
            if (!source) return null
            const rect = shiftedRect(source, delta)
            const range = containerCellRange(rect)
            const clear = !containers.some(c => c.id !== containerId && movable(c) && rangesOverlap(range, containerCellRange(c))) && !tiles.some(t => t.containerId !== containerId && isPlaced(t.position) && rangesOverlap(range, tileRange(t)))
            return { source, rect, valid: clear, moved: delta.col !== 0 || delta.row !== 0 }
        },
        [containers, tiles]
    )
    const boxDrop = useMemo(() => (boxDrag ? dropFor(boxDrag.containerId, boxDrag.delta) : null), [boxDrag, dropFor])
    const boxDragRef = useRef(boxDrag)
    boxDragRef.current = boxDrag
    const boxDropRef = useRef(boxDrop)
    boxDropRef.current = boxDrop

    const settle = (containerId: string) => {
        setSettlingContainerId(containerId)
        clearTimeout(settleTimerRef.current)
        settleTimerRef.current = setTimeout(() => setSettlingContainerId(null), SETTLE_MS)
    }
    useEffect(() => () => clearTimeout(settleTimerRef.current), [])

    const finishBoxDrag = (commit: boolean) => {
        const drop = boxDropRef.current
        setBoxDrag(null)
        if (!drop) return
        settle(drop.source.id)
        if (commit && drop.valid && drop.moved) onContainerMove?.(drop.source.id, drop.rect)
    }
    const finishBoxDragRef = useRef(finishBoxDrag)
    finishBoxDragRef.current = finishBoxDrag

    const containerGripAt = (clientX: number, clientY: number, cell: Cell | null) => {
        if (!onContainerMove || locked || mode === 'draw' || !cell) return null
        const c = containers.find(c => movable(c) && containerContainsCell(c, cell))
        if (!c || c.readOnly) return null
        return getTileFromClient(clientX, clientY, tiles) ? null : c.id
    }
    const containerGripAtRef = useRef(containerGripAt)
    containerGripAtRef.current = containerGripAt

    const resolvePlacementAtClientPoint = useCallback(
        (clientX: number, clientY: number) => {
            const rawAnchor = getTileAnchorFromClient(clientX, clientY, placeSpan)
            if (!rawAnchor) return null

            const c = clampPlacementToContainer ? placementTargets[0] : undefined
            const anchor = c ? clampAnchorToRange(containerCellRange(c), placeSpan, rawAnchor) : rawAnchor
            const insideContainer = placementTargets.some(c => containerContainsTile(c, anchor, placeSpan))
            const occupied = tiles.some(t => t.id !== placingTileId && isPlaced(t.position) && tilesOverlap(anchor, t.position, placeSpan, spanOf(t)))

            return { anchor, valid: insideContainer && !occupied }
        },
        [getTileAnchorFromClient, placeSpan, clampPlacementToContainer, placementTargets, tiles, placingTileId]
    )

    const clampAnchorToContainer = (containerId: string | null, span: number, anchor: { col: number; row: number }) => {
        const c = containerId ? containers.find(ct => ct.id === containerId) : null
        if (!c) return anchor
        return clampAnchorToRange(containerCellRange(c), span, anchor)
    }

    const dragOriginContainerId = dragState ? tiles.find(t => t.id === dragState.tileId)?.containerId ?? null : null
    const dragTargetContainerId = dragState && dragState.containerId !== dragOriginContainerId ? dragState.containerId : null

    const beginGesture = useCallback(() => {
        restorePendingRef.current = false
        userFramedRef.current = true
        pushedCameraRef.current = null
        cancelAnim()
    }, [cancelAnim])
    const beginFraming = useCallback(() => {
        restorePendingRef.current = false
        userFramedRef.current = true
        animate()
    }, [animate])

    useEffect(() => {
        const container = containerRef.current
        if (!container || !gestures) return
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault()
            beginGesture()
            if (e.ctrlKey || e.metaKey) {
                setZoom(z => Math.min(3, Math.max(0.3, z - e.deltaY * 0.001)))
            } else {
                const z = zoomRef.current
                setPan(p => clampPan({ x: p.x - e.deltaX / z, y: p.y - e.deltaY / z }, z))
            }
        }
        container.addEventListener('wheel', handleWheel, { passive: false })
        return () => container.removeEventListener('wheel', handleWheel)
    }, [gestures, clampPan, beginGesture])

    useEffect(() => {
        if (restorePendingRef.current) {
            if (!contentBox) return
            restorePendingRef.current = false
        }
        setPan(p => clampPan(p, zoom))
    }, [zoom, clampPan, panBounds, contentBox])

    const onCameraChangeRef = useRef(onCameraChange)
    onCameraChangeRef.current = onCameraChange

    useEffect(() => {
        if (!camera) return
        restoredRef.current = true

        const previous = requestedCameraRef.current
        requestedCameraRef.current = camera
        if (previous && previous.zoom === camera.zoom && previous.pan.x === camera.pan.x && previous.pan.y === camera.pan.y) return

        const nextPan = clampPan(camera.pan, camera.zoom)
        if (previous) animate(cameraTransitionMs)
        pushedCameraRef.current = { pan: nextPan, zoom: camera.zoom }
        setZoom(camera.zoom)
        setPan(nextPan)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [camera?.zoom, camera?.pan.x, camera?.pan.y, cameraTransitionMs, clampPan, animate])

    useEffect(() => {
        const pushed = pushedCameraRef.current
        if (pushed && pushed.zoom === zoom && pushed.pan.x === pan.x && pushed.pan.y === pan.y) return
        onCameraChangeRef.current?.({ pan, zoom })
    }, [pan, zoom])

    const frameInsetRef = useRef(frameInset)
    frameInsetRef.current = frameInset

    const recenterView = useCallback(() => {
        const container = containerRef.current
        if (!container) return
        beginFraming()
        const rect = layoutBox(container)
        const box = contentBoxRef.current
        if (!box) {
            setZoom(initialZoomDesktop)
            setPan(clampPan({ x: 0, y: 0 }, initialZoomDesktop))
            return
        }
        const camera = fitCamera(box, rect, 3, RECENTER_PADDING, frameInsetRef.current)
        setZoom(camera.zoom)
        setPan(clampPan(camera.pan, camera.zoom))
    }, [clampPan, initialZoomDesktop, beginFraming])

    const recenterSignalRef = useRef(recenterSignal)
    useEffect(() => {
        if (recenterSignal === recenterSignalRef.current) return
        recenterSignalRef.current = recenterSignal
        recenterView()
    }, [recenterSignal, recenterView])

    const tilesRef = useRef(tiles)
    tilesRef.current = tiles

    const focusTile = useCallback(
        (request: IsoFocusRequest) => {
            const container = containerRef.current
            const tile = tilesRef.current.find(t => t.id === request.tileId)
            if (!container || !tile || !isPlaced(tile.position)) return
            beginFraming()
            const rect = layoutBox(container)
            const box = tileBox(tile.position.col, tile.position.row, spanOf(tile), WORLD_OFFSET)
            const nextZoom = Math.max(zoomRef.current, initialZoomDesktop)
            const insetRight = request.insetRight && request.insetRight < rect.width * 0.75 ? request.insetRight : 0
            const pan = { x: -(box.left + box.width / 2) - insetRight / 2 / nextZoom, y: -(box.top + box.height / 2) }
            setZoom(nextZoom)
            setPan(clampPan(pan, nextZoom))
        },
        [beginFraming, clampPan, initialZoomDesktop]
    )

    const focusNonceRef = useRef(focusRequest?.nonce)
    useEffect(() => {
        if (!focusRequest || focusRequest.nonce === focusNonceRef.current) return
        focusNonceRef.current = focusRequest.nonce
        focusTile(focusRequest)
    }, [focusRequest, focusTile])

    const { left: insetLeft, right: insetRight } = frameInset
    const fittedRef = useRef(false)
    useEffect(() => {
        const container = containerRef.current
        if (!fitToContent || !container || restoredRef.current) return
        const applyFit = () => {
            if (userFramedRef.current) return
            const box = contentBoxRef.current
            const rect = layoutBox(container)
            if (!box || rect.width === 0 || rect.height === 0) return
            const camera = fitCamera(box, rect, initialZoomDesktop, FIT_PADDING, { left: insetLeft, right: insetRight })
            if (fittedRef.current) animate()
            fittedRef.current = true
            setZoom(camera.zoom)
            setPan(clampPan(camera.pan, camera.zoom))
        }
        const observer = new ResizeObserver(applyFit)
        observer.observe(container)
        return () => observer.disconnect()
    }, [fitToContent, initialZoomDesktop, clampPan, insetLeft, insetRight, animate])

    const zoomIn = useCallback(() => {
        beginFraming()
        setZoom(z => Math.min(3, z * 1.2))
    }, [beginFraming])
    const zoomOut = useCallback(() => {
        beginFraming()
        setZoom(z => Math.max(0.3, z / 1.2))
    }, [beginFraming])

    const startPan = useCallback((e: React.PointerEvent) => {
        if (locked) return
        beginGesture()
        setIsPanning(true)
        panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
    }, [pan, beginGesture, locked])

    const handlePointerDown = (e: React.PointerEvent) => {
        if (e.pointerType === 'touch') return

        setHoverCell(null)

        const cell = getGridCoords(e)
        if (!cell) return

        if (placementActive && onConfirmPlacement) {
            const placement = resolvePlacementAtClientPoint(e.clientX, e.clientY)
            if (placement?.valid) onConfirmPlacement(placement.anchor)
            return
        }

        if (e.button === 1 || e.altKey) {
            startPan(e)
            return
        }

        if (e.button === 2) {
            if (onTileContextMenu) {
                const t = getTileFromClient(e.clientX, e.clientY, tiles.filter(t => t.selectable !== false))
                if (t) return
            }
            if (onContainerContextMenu) {
                const rightClicked = containers.find(c => containerContainsCell(c, cell))
                if (rightClicked) return
            }
            startPan(e)
            return
        }

        if (mode === 'draw' && onCreateContainerRequest) {
            setDrawStart(cell)
            setDrawEnd(cell)
            return
        }

        if (selectedContainerId && onResizeContainerLocal) {
            const c = containers.find(c => c.id === selectedContainerId)
            const handle = c && !c.readOnly ? handleAtCell(c, cell) : null
            if (c && handle) {
                e.currentTarget.setPointerCapture(e.pointerId)
                setResizeState({ containerId: c.id, handle })
                onResizingContainerChange?.(c.id)
                return
            }
        }

        const gripped = containerGripAt(e.clientX, e.clientY, cell)
        if (gripped) {
            e.currentTarget.setPointerCapture(e.pointerId)
            pendingBoxDragRef.current = { containerId: gripped, grab: cell, origin: { x: e.clientX, y: e.clientY } }
            return
        }

        const clickedTile = onTileSelect || onTileMove ? getTileFromClient(e.clientX, e.clientY, tiles) : undefined
        if (clickedTile) {
            const canSelect = clickedTile.selectable ?? !!onTileSelect
            const canDrag = (clickedTile.draggable ?? !!onTileMove) && !!onTileMove
            const refusable = !canDrag && clickedTile.draggable === false && !!onTileMove && !!onTileMoveRefused
            if (canDrag || refusable) {
                e.currentTarget.setPointerCapture(e.pointerId)
                pendingDragRef.current = {
                    tileId: clickedTile.id,
                    startPos: clickedTile.position,
                    span: spanOf(clickedTile),
                    containerId: clickedTile.containerId ?? null,
                    origin: { x: e.clientX, y: e.clientY },
                    select: canSelect,
                    refused: refusable,
                }
                return
            }
            if (canSelect) {
                onTileSelect?.(clickedTile.id)
                onContainerSelect?.(null)
                return
            }
        }

        const clickedContainer = onContainerSelect ? containers.find(c => containerContainsCell(c, cell)) : undefined
        if (clickedContainer) {
            onContainerSelect?.(clickedContainer.id)
            onTileSelect?.(null)
            return
        }

        onTileSelect?.(null)
        onContainerSelect?.(null)
        startPan(e)
    }

    const handlePointerMove = (e: React.PointerEvent) => {
        if (e.pointerType === 'touch') return

        const pending = pendingDragRef.current
        if (pending) {
            if (Math.hypot(e.clientX - pending.origin.x, e.clientY - pending.origin.y) < DRAG_THRESHOLD_PX) return
            pendingDragRef.current = null
            const { tileId, startPos, span, containerId } = pending
            if (pending.refused) {
                onTileMoveRefused?.(tileId)
                return
            }
            const anchor = getTileAnchorFromClient(e.clientX, e.clientY, span)
            clearRefusal()
            setDragState({ tileId, startPos, span, containerId })
            setDragGhostCell(anchor ? (canDropTile ? anchor : clampAnchorToContainer(containerId, span, anchor)) : startPos)
            return
        }

        const pendingBox = pendingBoxDragRef.current
        if (pendingBox) {
            if (Math.hypot(e.clientX - pendingBox.origin.x, e.clientY - pendingBox.origin.y) < DRAG_THRESHOLD_PX) return
            pendingBoxDragRef.current = null
            setHoverCell(null)
            setHoverHandle(null)
            setHoverContainerId(null)
            setBoxDrag({ containerId: pendingBox.containerId, grab: pendingBox.grab, delta: { col: 0, row: 0 } })
            return
        }

        onPointerWorldMove?.(getWorldCoords(e.clientX, e.clientY))

        if (boxDrag) {
            const at = getGridCoords(e)
            if (!at) return
            const delta = { col: at.col - boxDrag.grab.col, row: at.row - boxDrag.grab.row }
            if (delta.col !== boxDrag.delta.col || delta.row !== boxDrag.delta.row) setBoxDrag({ ...boxDrag, delta })
            return
        }

        const cell = getGridCoords(e)
        setHoverGripId(containerGripAt(e.clientX, e.clientY, cell))
        const hoverSpan = placementActive ? placeSpan : DEFAULT_SPAN
        const anchor = getTileAnchorFromClient(e.clientX, e.clientY, hoverSpan)
        const overPill = !placementActive && e.target instanceof Element && !!e.target.closest('.iso-placeholder-label')
        if (overPill) {
            setHoverCell(null)
        } else if (anchor && interactive) {
            const c = placementActive && clampPlacementToContainer ? placementTargets[0] : undefined
            setHoverCell(c ? clampAnchorToRange(containerCellRange(c), hoverSpan, anchor) : anchor)
            setHoverTileId(getTileFromClient(e.clientX, e.clientY, tiles)?.id ?? null)
        }

        const resizable = interactive && !isPanning && !dragState && !drawStart && !placementActive && selectedContainerId && onResizeContainerLocal
        const selectedContainer = resizable ? containers.find(c => c.id === selectedContainerId) : undefined
        setHoverHandle(selectedContainer && !selectedContainer.readOnly && cell ? handleAtCell(selectedContainer, cell) : null)

        if ((onContainerAdd || onContainerMove) && !overAddHandleRef.current) {
            const idle = interactive && !isPanning && !dragState && !drawStart && !placementActive && mode !== 'draw'
            const exact = idle && cell ? containers.find(c => containerContainsCell(c, cell)) : undefined
            const halo = !exact && idle && cell ? containers.find(c => c.id === hoverContainerId && containerContainsCell(c, cell, ADD_HALO)) : undefined
            setHoverContainerId(exact?.id ?? halo?.id ?? null)
        }

        if (isPanning) {
            const dx = (e.clientX - panStart.current.x) / zoom
            const dy = (e.clientY - panStart.current.y) / zoom
            setPan(clampPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy }, zoom))
            return
        }

        if (dragState) {
            const dragAnchor = getTileAnchorFromClient(e.clientX, e.clientY, dragState.span)
            if (!dragAnchor) return
            const hovered = dragState.containerId && cell ? containers.find(c => containerContainsCell(c, cell)) : undefined
            const containerId = hovered?.id ?? dragState.containerId
            if (containerId !== dragState.containerId) setDragState({ ...dragState, containerId })
            setDragGhostCell(canDropTile ? dragAnchor : clampAnchorToContainer(containerId, dragState.span, dragAnchor))
            return
        }

        if (drawStart && cell) {
            setDrawEnd(cell)
        }

        if (resizeState && cell && onResizeContainerLocal) {
            const c = containers.find(ct => ct.id === resizeState.containerId)
            if (c) {
                const inside = tiles.filter(t => t.containerId === resizeState.containerId && isPlaced(t.position)).map(t => ({ col: t.position.col, row: t.position.row, span: spanOf(t) }))
                onResizeContainerLocal(resizeState.containerId, resizedContainerRect(c, resizeState.handle, cell, inside))
            }
        }
    }

    const handlePointerUp = (e: React.PointerEvent) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
        setIsPanning(false)

        const pending = pendingDragRef.current
        if (pending) {
            pendingDragRef.current = null
            if (pending.select && e.type !== 'pointercancel') {
                onTileSelect?.(pending.tileId)
                onContainerSelect?.(null)
            }
            return
        }

        const pendingBox = pendingBoxDragRef.current
        if (pendingBox) {
            pendingBoxDragRef.current = null
            if (e.type !== 'pointercancel') {
                onContainerSelect?.(pendingBox.containerId)
                onTileSelect?.(null)
            }
            return
        }

        if (boxDrag) {
            finishBoxDrag(e.type !== 'pointercancel')
            return
        }

        if (resizeState) {
            onResizeContainerCommit?.(resizeState.containerId)
            onResizingContainerChange?.(null)
            setResizeState(null)
            return
        }

        if (drawStart && drawEnd && canDraw && onCreateContainerRequest) {
            const colStart = Math.min(drawStart.col, drawEnd.col)
            const colEnd = Math.max(drawStart.col, drawEnd.col)
            const rowStart = Math.min(drawStart.row, drawEnd.row)
            const rowEnd = Math.max(drawStart.row, drawEnd.row)

            if (colEnd - colStart >= MIN_CONTAINER_SPAN - 1 && rowEnd - rowStart >= MIN_CONTAINER_SPAN - 1) {
                onCreateContainerRequest({ colStart, rowStart, colEnd, rowEnd })
            }

            setDrawStart(null)
            setDrawEnd(null)
            return
        }

        if (dragState && dragGhostCell) {
            const didMove = dragGhostCell.col !== dragState.startPos.col || dragGhostCell.row !== dragState.startPos.row
            if (didMove && onTileMove && canDropTile) {
                const holder = containers.find(ct => containerContainsCell(ct, dragGhostCell))
                const reason = canDropTile(dragState.tileId, dragGhostCell, holder?.id ?? null)
                if (reason === null) onTileMove(dragState.tileId, dragGhostCell, holder?.id)
                else {
                    clearRefusal()
                    setRefusal({ cell: dragGhostCell, span: dragState.span, reason })
                    refusalTimerRef.current = setTimeout(clearRefusal, DROP_REFUSAL_MS)
                    onTileMoveRefused?.(dragState.tileId)
                }
            } else if (didMove && onTileMove) {
                const tile = tiles.find(t => t.id === dragState.tileId)
                const target = tile?.containerId ? containers.find(ct => containerContainsTile(ct, dragGhostCell, dragState.span)) : undefined
                const landed = tile?.containerId ? !!target : true
                const occupied = tiles.some(t => t.id !== dragState.tileId && isPlaced(t.position) && tilesOverlap(dragGhostCell, t.position, dragState.span, spanOf(t)))
                if (!occupied && landed && target?.readOnly) onTileMoveRefused?.(dragState.tileId)
                else if (!occupied && landed) onTileMove(dragState.tileId, dragGhostCell, target?.id)
            }
            setDragState(null)
            setDragGhostCell(null)
        }
    }

    const touchTilesRef = useRef(tiles)
    touchTilesRef.current = tiles
    const touchContainersRef = useRef(containers)
    touchContainersRef.current = containers

    const touchCallbacks = useMemo(
        () => ({
            onPan(dx: number, dy: number) {
                beginGesture()
                const z = zoomRef.current
                setPan(p => clampPan({ x: p.x + dx / z, y: p.y + dy / z }, z))
            },
            onZoom(scaleFactor: number, _centerX: number, _centerY: number) {
                beginGesture()
                setZoom(z => Math.min(3, Math.max(0.3, z * scaleFactor)))
            },
            onTap(clientX: number, clientY: number) {
                if (placementActive && onConfirmPlacement) {
                    const placement = resolvePlacementAtClientPoint(clientX, clientY)
                    if (!placement) return
                    setHoverCell(placement.anchor)
                    if (placement.valid) onConfirmPlacement(placement.anchor)
                    return
                }

                if (!onTileSelect && !onContainerSelect) return
                const cell = getGridCoordsFromClient(clientX, clientY)
                if (!cell) return

                const tappedTile = onTileSelect ? getTileFromClient(clientX, clientY, touchTilesRef.current) : undefined
                if (tappedTile && (tappedTile.selectable ?? true)) {
                    onTileSelect?.(tappedTile.id)
                    onContainerSelect?.(null)
                    return
                }

                const tappedContainer = onContainerSelect ? touchContainersRef.current.find(c => containerContainsCell(c, cell)) : undefined
                if (tappedContainer) {
                    onContainerSelect?.(tappedContainer.id)
                    onTileSelect?.(null)
                } else {
                    onTileSelect?.(null)
                    onContainerSelect?.(null)
                }
            },
            grabAt(clientX: number, clientY: number) {
                if (placementActive || boxDragRef.current) return false
                const cell = getGridCoordsFromClient(clientX, clientY)
                const containerId = containerGripAtRef.current(clientX, clientY, cell)
                if (!containerId || !cell) return false
                touchGrabRef.current = { containerId, grab: cell }
                return true
            },
            onGrabHold(clientX: number, clientY: number) {
                setHoldPoint(getWorldCoords(clientX, clientY))
            },
            onGrabStart() {
                setHoldPoint(null)
                const grabbed = touchGrabRef.current
                if (grabbed) setBoxDrag({ ...grabbed, delta: { col: 0, row: 0 } })
            },
            onGrabMove(clientX: number, clientY: number) {
                const held = boxDragRef.current
                const cell = getGridCoordsFromClient(clientX, clientY)
                if (held && cell) setBoxDrag({ ...held, delta: { col: cell.col - held.grab.col, row: cell.row - held.grab.row } })
            },
            onGrabEnd(committed: boolean) {
                setHoldPoint(null)
                touchGrabRef.current = null
                if (boxDragRef.current) finishBoxDragRef.current(committed)
            },
        }),
        [placementActive, onConfirmPlacement, resolvePlacementAtClientPoint, getGridCoordsFromClient, getTileFromClient, getWorldCoords, onTileSelect, onContainerSelect, clampPan, beginGesture]
    )

    useTouchGestures(containerRef, touchCallbacks, gestures)

    const draggingBox = !!boxDrag
    useEffect(() => {
        if (!draggingBox) return
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') finishBoxDragRef.current(false)
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [draggingBox])

    const handleContextMenu = (e: React.MouseEvent) => {
        const cell = getGridCoords(e)
        if (!cell) {
            e.preventDefault()
            return
        }

        if (onTileContextMenu) {
            const tile = getTileFromClient(e.clientX, e.clientY, tiles.filter(tile => tile.selectable !== false))
            if (tile) {
                onTileContextMenu(tile.id, e.clientX, e.clientY)
                return
            }
        }

        if (onContainerContextMenu) {
            const container = containers.find(container => containerContainsCell(container, cell))
            if (container) {
                onContainerContextMenu(container.id, e.clientX, e.clientY)
                return
            }
        }

        e.preventDefault()
    }

    const worldOffset = WORLD_OFFSET

    const patternPath = `M ${TILE_W / 2} 0 L ${TILE_W} ${TILE_H / 2} L ${TILE_W / 2} ${TILE_H} L 0 ${TILE_H / 2} Z`

    const floorPatternId = `isoTile-${useId()}`
    const svgHalfW = SVG_HALF_W
    const svgHalfH = SVG_HALF_H

    const resolvedShowLinks = showLinks ?? liveLinks.length > 0

    const engagedHandle = resizeState?.handle ?? hoverHandle

    const hoveredTile =
        interactive && !dragState && !boxDrag && !placementActive && hoverCell != null
            ? placedTiles.find(t => t.id === hoverTileId)
            : undefined

    const cursorClass = !interactive
        ? locked
            ? 'cursor-default'
            : isPanning
              ? 'cursor-grabbing'
              : 'cursor-grab'
        : boxDrag
          ? 'cursor-grabbing'
          : engagedHandle
          ?
            engagedHandle === 'top' || engagedHandle === 'bottom'
              ? 'cursor-ns-resize'
              : 'cursor-ew-resize'
          : isPanning || dragState
            ? 'cursor-grabbing'
            : hoverGripId
              ? 'cursor-grab'
              : placingTileId || placing
              ? 'cursor-copy'
              : mode === 'draw'
                ? 'cursor-crosshair'
                : 'cursor-default'

    const latestToast = toasts.length > 0 ? toasts[toasts.length - 1] : null
    const liveMessage = latestToast
        ? (() => {
              const tile = tiles.find(t => t.id === latestToast.tileId)
              const who = tile?.ariaLabel ?? tile?.style.label
              return who ? `${who}: ${latestToast.message}` : latestToast.message
          })()
        : ''

    return (
        <div className="absolute inset-0">
        <div
            ref={containerRef}
            role={interactive ? 'group' : undefined}
            aria-label={interactive ? t('isoGrid.board') : undefined}
            data-iso-paused={paused || !onScreen ? '' : undefined}
            className={`absolute inset-0 overflow-hidden select-none ${cursorClass}${className ? ` ${className}` : ''}`}
            style={{
                touchAction: gestures ? 'none' : 'auto',
                ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : {}),
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={() => {
                onPointerWorldMove?.(null)
                setHoverHandle(null)
                setHoverCell(null)
                setHoverContainerId(null)
                setHoverGripId(null)
                overAddHandleRef.current = false
                setAddSide(null)
            }}
            onContextMenu={handleContextMenu}
        >
            {interactive && (
                <div className="sr-only" aria-live="polite" aria-atomic="true">
                    {liveMessage}
                </div>
            )}
            <div
                className="absolute pointer-events-none"
                style={{
                    left: worldAnchor.left,
                    top: worldAnchor.top,
                    transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
                    transformOrigin: '0 0',
                    transition: animating ? `transform ${transitionMs}ms ${CAMERA_EASE}` : undefined,
                }}
            >
                <svg className="absolute" style={{ left: -svgHalfW, top: -svgHalfH, pointerEvents: 'none' }} width={svgHalfW * 2} height={svgHalfH * 2}>
                    <defs>
                        <pattern id={floorPatternId} width={TILE_W} height={TILE_H} patternUnits="userSpaceOnUse">
                            <path d={patternPath} fill="none" style={{ stroke: 'rgb(var(--iso-glint) / 0.06)' }} strokeWidth={Math.max(FLOOR_LINE_MIN, FLOOR_LINE_PX / zoom)} />
                        </pattern>
                    </defs>
                    <rect width={svgHalfW * 2} height={svgHalfH * 2} fill={`url(#${floorPatternId})`} />
                </svg>

                {boxDrop && (
                    <ContainerBlock container={{ ...boxDrop.source, id: `${boxDrop.source.id}:origin`, label: null, cta: undefined, ghost: true }} worldOffset={worldOffset} selected={false} still />
                )}

                {containers.map(container => {
                    const carried = boxDrop?.source.id === container.id
                    return (
                        <ContainerBlock
                            key={container.id}
                            container={carried ? { ...container, ...boxDrop.rect, color: boxDrop.valid ? container.color : INVALID_DROP_COLOR } : container}
                            worldOffset={worldOffset}
                            selected={container.id === selectedContainerId}
                            highlighted={(placementActive && hoverCell != null && containerContainsTile(container, hoverCell, placeSpan)) || (container.id === dragTargetContainerId && !container.readOnly) || carried}
                            activeHandle={container.id === selectedContainerId ? engagedHandle : null}
                            resizing={resizeState?.containerId === container.id}
                            hovered={container.id === hoverContainerId}
                            still={reducedMotion || paused || !onScreen}
                            onActivate={onContainerSelect ? () => onContainerSelect(container.id) : undefined}
                            glide={carried || container.id === settlingContainerId}
                        />
                    )
                })}

                {resolvedShowLinks && <TileLinks tiles={placedTiles} liveLinks={liveLinks} containers={containers} worldOffset={worldOffset} svgHalfW={svgHalfW} svgHalfH={svgHalfH} />}

                {drawStart && drawEnd && <ContainerDrawPreview start={drawStart} end={drawEnd} worldOffset={worldOffset} color={drawColor} />}

                {interactive &&
                    hoverCell &&
                    !dragState &&
                    !boxDrag &&
                    !drawStart &&
                    (() => {
                        const hoverSpan = placementActive ? placeSpan : DEFAULT_SPAN
                        const box = tileBox(hoverCell.col, hoverCell.row, hoverSpan, worldOffset)
                        return (
                            <div
                                className="absolute"
                                style={{
                                    left: box.left,
                                    top: box.top,
                                    width: box.width,
                                    height: box.height,
                                    clipPath: DIAMOND,
                                    backgroundColor: 'rgb(var(--iso-glint) / 0.08)',
                                    pointerEvents: 'none',
                                    zIndex: tileZ(hoverCell.col, hoverCell.row, hoverSpan, 9999),
                                }}
                            />
                        )
                    })()}

                {dragState &&
                    (() => {
                        const box = tileBox(dragState.startPos.col, dragState.startPos.row, dragState.span, worldOffset)
                        return (
                            <div
                                className="absolute"
                                style={{
                                    left: box.left,
                                    top: box.top,
                                    width: box.width,
                                    height: box.height,
                                    clipPath: DIAMOND,
                                    backgroundColor: 'rgb(var(--iso-glint) / 0.08)',
                                    pointerEvents: 'none',
                                    zIndex: tileZ(dragState.startPos.col, dragState.startPos.row, dragState.span, 10000),
                                }}
                            />
                        )
                    })()}

                {refusal && canDropTile && !dragState && <DropHint box={tileBox(refusal.cell.col, refusal.cell.row, refusal.span, worldOffset)} span={refusal.span} reason={refusal.reason} zIndex={tileZ(refusal.cell.col, refusal.cell.row, refusal.span, 10000)} />}

                {dragState &&
                    dragGhostCell &&
                    canDropTile &&
                    (() => {
                        const isStart = dragGhostCell.col === dragState.startPos.col && dragGhostCell.row === dragState.startPos.row
                        const holder = containers.find(ct => containerContainsCell(ct, dragGhostCell))
                        const reason = isStart ? null : canDropTile(dragState.tileId, dragGhostCell, holder?.id ?? null)
                        return <DropHint box={tileBox(dragGhostCell.col, dragGhostCell.row, dragState.span, worldOffset)} span={dragState.span} reason={reason} zIndex={tileZ(dragGhostCell.col, dragGhostCell.row, dragState.span, 10000)} />
                    })()}

                {dragState &&
                    dragGhostCell &&
                    !canDropTile &&
                    (() => {
                        const box = tileBox(dragGhostCell.col, dragGhostCell.row, dragState.span, worldOffset)
                        const W = dragState.span * TILE_W
                        const H = dragState.span * TILE_H
                        const occupied = tiles.some(t => t.id !== dragState.tileId && isPlaced(t.position) && tilesOverlap(dragGhostCell, t.position, dragState.span, spanOf(t)))
                        const refused = occupied || !!containers.find(ct => containerContainsTile(ct, dragGhostCell, dragState.span))?.readOnly
                        return (
                            <svg
                                className="absolute pointer-events-none"
                                style={{
                                    left: box.left,
                                    top: box.top,
                                    width: box.width,
                                    height: box.height,
                                    zIndex: tileZ(dragGhostCell.col, dragGhostCell.row, dragState.span, 10000),
                                    transition: 'left 150ms cubic-bezier(0.2, 0, 0, 1), top 150ms cubic-bezier(0.2, 0, 0, 1)',
                                }}
                            >
                                <polygon points={`${W / 2},0 ${W},${H / 2} ${W / 2},${H} 0,${H / 2}`} fill="none" style={{ stroke: refused ? '#ef4444' : 'rgb(var(--iso-glint) / 0.3)' }} strokeWidth="1" strokeDasharray="4 3" />
                            </svg>
                        )
                    })()}

                {selectedTileId &&
                    (() => {
                        const sel = placedTiles.find(t => t.id === selectedTileId)
                        if (!sel) return null
                        const span = spanOf(sel)
                        return <BeamRing box={tileBox(sel.position.col, sel.position.row, span, worldOffset)} zIndex={tileZ(sel.position.col, sel.position.row, span, 10000)} span={span} />
                    })()}

                {placedTiles.map(tile => {
                    const isDragging = dragState?.tileId === tile.id
                    const carried = !!boxDrag && tile.containerId === boxDrag.containerId
                    const dragPosition = isDragging && dragGhostCell ? dragGhostCell : carried ? { col: tile.position.col + boxDrag.delta.col, row: tile.position.row + boxDrag.delta.row } : undefined
                    return <TileBlock key={tile.id} tile={tile} selected={tile.id === selectedTileId} hovered={tile.id === hoveredTile?.id} isDragging={isDragging} dragPosition={dragPosition} worldOffset={worldOffset} onSelect={onTileSelect} reducedMotion={reducedMotion} paused={paused || !onScreen} justPlaced={tile.justPlaced} />
                })}

                <TileStatusBubble tile={hoveredTile ?? null} worldOffset={worldOffset} reducedMotion={reducedMotion} />
                <TileResultsCard tile={hoveredTile ?? null} worldOffset={worldOffset} reducedMotion={reducedMotion} />

                {toasts.map(toast => {
                    const tile = placedTiles.find(t => t.id === toast.tileId)
                    if (!tile) return null
                    return <TileToastBubble key={toast.id} toast={toast} tile={tile} worldOffset={worldOffset} onExpire={onToastExpire} reducedMotion={reducedMotion} />
                })}

                {holdPoint && (
                    <div className="absolute pointer-events-none" style={{ left: holdPoint.x, top: holdPoint.y, zIndex: 99999, transform: `scale(${1 / zoom})` }}>
                        <div className="iso-hold-ring" />
                    </div>
                )}

                {onContainerAdd &&
                    !placementActive &&
                    !dragState &&
                    !boxDrag &&
                    !drawStart &&
                    containers.map(container => {
                        if (container.variant === 'placeholder' || container.variant === 'loading') return null
                        if (container.id !== hoverContainerId && container.id !== selectedContainerId) return null
                        const sides = addSidesByContainer.get(container.id)
                        if (!sides || sides.length === 0) return null
                        return (
                            <ContainerAddHandles
                                key={container.id}
                                container={container}
                                sides={sides}
                                worldOffset={worldOffset}
                                label={containerAddLabel ?? t('isoGrid.addBlock')}
                                activeSide={addSide?.containerId === container.id ? addSide.side : null}
                                onAdd={handleContainerAdd}
                                onSideHover={handleAddSideHover}
                            />
                        )
                    })}

                {addSide &&
                    containerAddPreview &&
                    (() => {
                        const rect = containerAddPreview(addSide.containerId, addSide.side)
                        if (!rect) return null
                        return <ContainerDrawPreview start={{ col: rect.colStart, row: rect.rowStart }} end={{ col: rect.colEnd, row: rect.rowEnd }} worldOffset={worldOffset} color={drawColor} animated />
                    })()}

                {placementActive &&
                    hoverCell &&
                    (() => {
                        const insideContainer = placementTargets.some(c => containerContainsTile(c, hoverCell, placeSpan))
                        const occupied = tiles.some(t => t.id !== placingTileId && isPlaced(t.position) && tilesOverlap(hoverCell, t.position, placeSpan, spanOf(t)))
                        const valid = insideContainer && !occupied
                        const ghostTile: Tile = { id: '__ghost__', position: hoverCell, span: placeSpan, style: placeStyle }
                        return (
                            <>
                                <TileBlock tile={ghostTile} selected={false} worldOffset={worldOffset} ghost={{ valid }} />
                                <BeamRing box={tileBox(hoverCell.col, hoverCell.row, placeSpan, worldOffset)} zIndex={tileZ(hoverCell.col, hoverCell.row, placeSpan, 10000) + 1} color={valid ? 'var(--iso-outline-hot)' : '#ef4444'} span={placeSpan} />
                            </>
                        )
                    })()}

                {worldOverlay?.(zoom)}
            </div>
        </div>
        {showViewControls && <CanvasViewControls onZoomIn={zoomIn} onZoomOut={zoomOut} onRecenter={recenterView} placement={viewControlsPlacement} className={viewControlsClassName} />}
        </div>
    )
})
