import { useBoardStore } from '@/stores/board.store'
import type { GridPosition, SpacePublic } from '@/lib/board/types'
import type { SpaceOffset } from '@/stores/onboarding.store'

export function rebaseOffset(offset: SpaceOffset, corner: { colStart: number; rowStart: number }): GridPosition {
    return { col: corner.colStart + offset.col, row: corner.rowStart + offset.row }
}

export async function resolveTargetSpace(workspaceId: number): Promise<SpacePublic | null> {
    if (!useBoardStore.getState().hydrated) await useBoardStore.getState().hydrate(workspaceId)
    const { spaces, selectedSpaceId } = useBoardStore.getState()
    if (spaces.length === 0) return null
    return spaces.find(space => space.id === selectedSpaceId) ?? spaces[0]
}
