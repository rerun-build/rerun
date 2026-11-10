import type { Container, Tile } from '@rerun/ui/iso-grid'
import { BOX_MANAGE_ACTION_REASON, type BoxViewer } from './box-access'

// A Box the caller only uses is drawn like any other, but its handles, its grip, its drops and its
// recruit pill are closed: the pill keeps its examples and says why on hover, in `refusal`.
export function boxContainerFor(container: Container, manages: boolean, refusal: string = BOX_MANAGE_ACTION_REASON): Container {
    if (manages) return container
    return { ...container, readOnly: true, ...(container.cta ? { cta: refusal, ctaDisabled: true } : {}) }
}

// A coworker moves only out of a Box the caller manages.
export function boxTileFor(tile: Tile, manages: boolean): Tile {
    return manages ? tile : { ...tile, draggable: false }
}

export const MEMBER_EMPTY_BOARD_LABEL = 'Click to create a Box'

// A member's board is empty when no Box is open to them, not because the workspace is new: they are
// offered a Box of their own (they manage what they create), never the workspace onboarding.
export function emptyBoardOffersBox(role: BoxViewer['role'], visibleSpaceCount: number): boolean {
    return role === 'member' && visibleSpaceCount === 0
}

// A coworker always lands in a Box the caller manages. A member who manages none names one first,
// then the placement goes on. An admin manages every Box, so never needs to.
export function placementNeedsBoxFirst({ placing, role, manageableSpaceCount }: { placing: boolean; role: BoxViewer['role']; manageableSpaceCount: number }): boolean {
    return placing && role === 'member' && manageableSpaceCount === 0
}
