'use client'

import { useEffect, type RefObject } from 'react'
import { useIsMobile } from '@moldwright/ui/primitives/use-is-mobile'

import { FOREMAN_COLUMN_QUERY } from '@/lib/foreman-open'

export function useForemanSheetHeight({ panelRef, stackEl, slotEl }: { panelRef: RefObject<HTMLElement | null>; stackEl: HTMLElement | null; slotEl: HTMLElement | null }) {
    const isMobile = useIsMobile(FOREMAN_COLUMN_QUERY)

    useEffect(() => {
        const panel = panelRef.current
        if (!isMobile || !panel || !stackEl || !slotEl) return
        const publish = () => {
            const border = panel.offsetHeight - panel.clientHeight
            panel.style.setProperty('--foreman-sheet-h', `${stackEl.offsetHeight + slotEl.offsetHeight + border}px`)
            panel.style.setProperty('--foreman-sheet-slot-h', `${slotEl.offsetHeight + border}px`)
        }
        publish()
        const observer = new ResizeObserver(publish)
        observer.observe(stackEl)
        observer.observe(slotEl)
        return () => {
            observer.disconnect()
            panel.style.removeProperty('--foreman-sheet-h')
            panel.style.removeProperty('--foreman-sheet-slot-h')
        }
    }, [isMobile, panelRef, stackEl, slotEl])
}
