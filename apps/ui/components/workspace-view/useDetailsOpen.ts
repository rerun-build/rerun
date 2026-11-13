'use client'

import { useIsMobile } from '@rerun/ui/primitives'

import { DETAILS_BESIDE_QUERY } from '@/lib/workspace-view'
import { useSimpleDetailsStore } from '@/stores/simple-details.store'

/** Beside the chat from `xl` the card is open until closed; over it below, closed until asked for. */
export function useDetailsBesideChat(): boolean {
    return !useIsMobile(`not all and ${DETAILS_BESIDE_QUERY}`)
}

export function useDetailsOpen(): boolean {
    const besideChat = useDetailsBesideChat()
    const wanted = useSimpleDetailsStore(s => s.wanted)
    return wanted ?? besideChat
}
