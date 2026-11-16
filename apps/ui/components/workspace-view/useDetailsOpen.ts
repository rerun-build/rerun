'use client'

import { useIsMobile } from '@rerun/ui/primitives'

import { DETAILS_BESIDE_QUERY } from '@/lib/workspace-view'
import { useSimpleDetailsStore } from '@/stores/simple-details.store'

/** From `xl` the card opens as a column beside the chat, below it slides over the chat. */
export function useDetailsBesideChat(): boolean {
    return !useIsMobile(`not all and ${DETAILS_BESIDE_QUERY}`)
}

export function useDetailsOpen(): boolean {
    return useSimpleDetailsStore(s => s.wanted)
}
