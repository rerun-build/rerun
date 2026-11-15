'use client'

import { useEffect, useRef } from 'react'

import { GettingStartedPill } from '@/components/foreman/getting-started/GettingStartedPill'
import { WorkspaceInbox } from '@/components/notifications/WorkspaceInbox'

export function BoardCornerActions() {
    const rowRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const row = rowRef.current
        if (!row) return
        const root = document.documentElement
        const observer = new ResizeObserver(() => root.style.setProperty('--board-corner-width', `${row.offsetWidth}px`))
        observer.observe(row)
        return () => {
            observer.disconnect()
            root.style.removeProperty('--board-corner-width')
        }
    }, [])

    return (
        <div ref={rowRef} className="absolute bottom-[calc(1rem+var(--consent-inset))] left-4 z-40 flex items-center gap-2">
            <WorkspaceInbox />
            <GettingStartedPill />
        </div>
    )
}
