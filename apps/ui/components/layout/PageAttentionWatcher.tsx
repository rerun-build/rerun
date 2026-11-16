'use client'

import { PAGE_UNATTENDED_ATTRIBUTE } from '@rerun/ui/primitives'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { usePageAttention } from '@/hooks/usePageAttention'

// Freezes the page's animations while nobody is in front of it (see the rule on
// `html[data-unattended]` in @rerun/ui/styles.css): the desktop app keeps rendering a hidden window,
// and a single endless animation costs a frame on every refresh of the screen.
// A /render page is embedded or captured and never holds the focus: the mobile app plays its sign-in
// board in a WebView nobody can touch, where `document.hasFocus()` stays false. It is never frozen.
export function PageAttentionWatcher() {
    const attention = usePageAttention()
    const embedded = usePathname().startsWith('/render/')

    useEffect(() => {
        document.documentElement.toggleAttribute(PAGE_UNATTENDED_ATTRIBUTE, !embedded && attention !== 'focused')
    }, [attention, embedded])

    useEffect(() => () => document.documentElement.removeAttribute(PAGE_UNATTENDED_ATTRIBUTE), [])

    return null
}
