import type { ReactNode } from 'react'
import type { BadgeTone } from '../primitives/badge'
import type { CanvasViewControlsPlacement } from '../CanvasViewControls'
import type { ContainerHandle, ContainerSide } from './iso'

export type GridPosition = { col: number; row: number }
export type WorldOffset = { left: number; top: number }

export type InteractionMode = 'select' | 'draw'

export type TileStyle = {
    color: string
    opacity?: number
    glow?: string
    haloColor?: string
    ink?: 'theme'
    label?: string
    image?: string
    imageFilter?: string
    depth?: number
    shimmer?: boolean // sheen animé sur les faces (statut « working »)
    sheen?: boolean // reflet spéculaire STATIQUE sur la face du dessus (look métal) ; ≠ shimmer
    stripes?: boolean | 'hover' // rayures diagonales ; 'hover' = uniquement au survol/sélection
    errorPulse?: boolean // overlay rouge pulsant (statut « error »)
    pingRings?: boolean // anneaux cyan + halo (statut « waiting_human »)
    badge?: 'hand' | 'lock' | null // pictogramme au-dessus de la tile
    status?: TileStatus
    countdown?: TileCountdown
    results?: TileResults
    buddy?: true | BuddyLook
}

export type BuddyEyes =
    | 'pill'
    | 'round'
    | 'happy'
    | 'googly'
    | 'visor'
    | 'sleepy'
    | 'wink'
    | 'pixel'
    | 'star'
    | 'heart'
    | 'dot'
    | 'brows'
    | 'cyclops'
    | 'shades'
    | 'glasses'
    | 'sparkle'
    | 'line'

export type BuddyMouth = 'none' | 'smile' | 'open' | 'cat' | 'flat'

export type BuddyMood = 'idle' | 'working' | 'error' | 'waiting' | 'asleep'

export type BuddyLook = {
    eyes?: BuddyEyes
    mouth?: BuddyMouth
    color?: string
    mood?: BuddyMood
    footprintShare?: number
}

export type TileCountdown = {
    at: number
}

export type TileResults = {
    count: number
    items: TileResultItem[]
}

export type TileResultItem = {
    label: string
    count: number
    at: number
}

export type TileStatusLabelKey = 'idle' | 'working' | 'error' | 'offline' | 'waiting_human' | 'disabled' | 'paused' | 'restoring'

export type TileStatus = {
    label: string
    labelKey?: TileStatusLabelKey
    tone: BadgeTone
    pinned?: TilePinnedStatus
}

export type TileStatusIcon = 'hand' | 'warning'

export type TilePinnedStatus = {
    label?: string
    labelKey?: TileStatusLabelKey
    icon?: TileStatusIcon
    count?: number
    spinner?: boolean
}

export type Tile = {
    id: string
    position: GridPosition // ancre = cellule nord (coin haut) du footprint
    span?: number // footprint N×N de la tile (1, 2, 3…) ; défaut DEFAULT_SPAN (=2)
    containerId?: string // si défini, borne le drag/placement à l'intérieur de ce container
    style: TileStyle
    selectable?: boolean // gate la sélection ; défaut: true si onTileSelect fourni
    draggable?: boolean // gate le drag ; défaut: true si onTileMove fourni
    highlighted?: boolean
    dimmed?: boolean
    justPlaced?: boolean
    dropDelay?: number
    ariaLabel?: string
}

export type ContainerVariant = 'default' | 'placeholder' | 'loading'
export type ContainerDropStyle = 'fade' | 'draw'

export type Container = {
    id: string
    label: string | null
    color: string
    col_start: number
    row_start: number
    col_end: number
    row_end: number
    variant?: ContainerVariant
    placeholderLabel?: string
    cta?: string
    ctaExamples?: string[]
    ctaDisabled?: boolean
    readOnly?: boolean
    ariaLabel?: string
    dimmed?: boolean
    justPlaced?: boolean
    dropDelay?: number
    dropStyle?: ContainerDropStyle
    dropDuration?: number
    ghost?: boolean
}

export type TileLink = { source: string; target: string; variant?: 'beam' | 'cable'; appearDelay?: number; color?: string }

export type TileToast = {
    id: string
    tileId: string
    message: string
    author?: string
}

export type ContainerRect = { colStart: number; rowStart: number; colEnd: number; rowEnd: number }
export type { ContainerHandle, ContainerSide }
export type ResizePatch = Partial<Pick<Container, 'col_start' | 'row_start' | 'col_end' | 'row_end'>>
export type ContainerCellRect = Pick<Container, 'col_start' | 'row_start' | 'col_end' | 'row_end'>

export type IsoCamera = { pan: { x: number; y: number }; zoom: number }

export type IsoFocusRequest = { tileId: string; nonce: number; insetRight?: number }

export type FrameInset = { left: number; right: number }

export type IsoGridProps = {
    tiles: Tile[]
    containers: Container[]
    liveLinks?: TileLink[]
    toasts?: TileToast[]

    selectedTileId?: string | null
    selectedContainerId?: string | null
    placingTileId?: string | null
    placing?: boolean
    placingTile?: { span?: number; style: TileStyle }
    placementContainerId?: string | null
    clampPlacementToContainer?: boolean
    mode?: InteractionMode

    showLinks?: boolean
    worldAnchor?: { left: string; top: string }
    initialPan?: { x: number; y: number }
    initialZoomDesktop?: number
    initialZoomMobile?: number
    initialCamera?: IsoCamera | null
    camera?: IsoCamera | null
    cameraTransitionMs?: number
    fitToContent?: boolean
    recenterSignal?: number
    frameInset?: FrameInset
    focusRequest?: IsoFocusRequest | null
    mask?: string | false
    drawColor?: string
    canDraw?: boolean
    className?: string
    paused?: boolean
    scrollGestures?: boolean
    locked?: boolean
    showViewControls?: boolean
    viewControlsPlacement?: CanvasViewControlsPlacement
    viewControlsClassName?: string

    onTileSelect?: (id: string | null) => void
    onContainerSelect?: (id: string | null) => void
    onConfirmPlacement?: (pos: GridPosition) => void
    onTileMove?: (id: string, pos: GridPosition, containerId?: string) => void
    onTileMoveRefused?: (id: string) => void
    onTileContextMenu?: (id: string, x: number, y: number) => void
    onResizeContainerLocal?: (id: string, patch: ResizePatch) => void
    onResizeContainerCommit?: (id: string) => void
    onResizingContainerChange?: (id: string | null) => void
    onContainerMove?: (id: string, rect: ContainerCellRect) => void

    onCreateContainerRequest?: (rect: ContainerRect) => void
    onContainerAdd?: (id: string, side: ContainerSide) => void
    containerAddPreview?: (id: string, side: ContainerSide) => ContainerRect | null
    containerAddLabel?: string
    onContainerContextMenu?: (id: string, x: number, y: number) => void

    onCameraChange?: (camera: IsoCamera) => void

    onToastExpire?: (id: string) => void

    onPointerWorldMove?: (world: { x: number; y: number } | null) => void
    worldOverlay?: (zoom: number) => ReactNode
}
