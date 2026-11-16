'use client'

import { useSyncExternalStore } from 'react'

import { pageAttention, subscribePageAttention, type PageAttention } from '@/lib/desktop-shell/attention'

// Focused on the server and on the first render, so the first paint animates.
export function usePageAttention(): PageAttention {
    return useSyncExternalStore(subscribePageAttention, pageAttention, () => 'focused')
}
