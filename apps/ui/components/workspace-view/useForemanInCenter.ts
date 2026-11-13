'use client'

import { useBoardStore } from '@/stores/board.store'
import { selectForemanOpen, selectForemanVisible, useForemanStore } from '@/stores/foreman.store'

/**
 * In the Simple view the Chief of Staff and a coworker share the middle, one at a time: it is on show
 * while its column is open and no coworker is. Read the same way by the frame, the list and its tile.
 */
export function useForemanInCenter(): boolean {
    const visible = useForemanStore(selectForemanVisible)
    const open = useForemanStore(selectForemanOpen)
    const coworkerOpen = useBoardStore(s => s.selectedAgentId !== null)
    return visible && open && !coworkerOpen
}
