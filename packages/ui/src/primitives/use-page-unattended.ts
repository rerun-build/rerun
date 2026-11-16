'use client'

import { useSyncExternalStore } from 'react'

// Set on <html> by the app while nobody is looking at the page: the window has lost the focus, sits
// hidden in the tray or minimized, or the tab is in the background. Decoration freezes under it.
export const PAGE_UNATTENDED_ATTRIBUTE = 'data-unattended'

function subscribe(onChange: () => void) {
    const observer = new MutationObserver(onChange)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [PAGE_UNATTENDED_ATTRIBUTE] })
    return () => observer.disconnect()
}

export function usePageUnattended(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => document.documentElement.hasAttribute(PAGE_UNATTENDED_ATTRIBUTE),
        () => false
    )
}
