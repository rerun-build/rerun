import type { Container, Tile } from '@rerun/ui/iso-grid'
import { BOX_MANAGE_ACTION_REASON, type BoxViewer } from './box-access'

export function boxContainerFor(container: Container, manages: boolean, refusal: string = BOX_MANAGE_ACTION_REASON): Container {
    if (manages) return container
    return { ...container, readOnly: true, ...(container.cta ? { cta: refusal, ctaDisabled: true } : {}) }
}

export function boxTileFor(tile: Tile, manages: boolean): Tile {
    return manages ? tile : { ...tile, draggable: false }
}

export const MEMBER_EMPTY_BOARD_LABEL = 'Click to create a Box'

export function emptyBoardOffersBox(role: BoxViewer['role'], visibleSpaceCount: number): boolean {
    return role === 'member' && visibleSpaceCount === 0
}

export function placementNeedsBoxFirst({ placing, role, manageableSpaceCount }: { placing: boolean; role: BoxViewer['role']; manageableSpaceCount: number }): boolean {
    return placing && role === 'member' && manageableSpaceCount === 0
}
