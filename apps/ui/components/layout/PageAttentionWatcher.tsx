'use client'

import { PAGE_UNATTENDED_ATTRIBUTE } from '@rerun/ui/primitives'
import { useEffect } from 'react'

import { usePageAttention } from '@/hooks/usePageAttention'

// Freezes the page's animations while nobody is in front of it (see the rule on
// `html[data-unattended]` in @rerun/ui/styles.css): the desktop app keeps rendering a hidden window,
// and a single endless animation costs a frame on every refresh of the screen.
export function PageAttentionWatcher() {
    const attention = usePageAttention()

    useEffect(() => {
        document.documentElement.toggleAttribute(PAGE_UNATTENDED_ATTRIBUTE, attention !== 'focused')
    }, [attention])

    useEffect(() => () => document.documentElement.removeAttribute(PAGE_UNATTENDED_ATTRIBUTE), [])

    return null
}
