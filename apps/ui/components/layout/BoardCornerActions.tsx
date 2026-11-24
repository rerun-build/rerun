'use client'

import { useEffect, useRef } from 'react'

import { GettingStartedPill } from '@/components/foreman/getting-started/GettingStartedPill'
import { WorkspaceInbox } from '@/components/notifications/WorkspaceInbox'

// Le bas n'est pas toujours le bas : la bannière cookies est `fixed bottom-0 z-60` en mobile, donc
// les boutons s'assoient sur l'inset qu'elle publie, comme la barre avec laquelle ils s'alignent.
// La rangée publie sa largeur : l'orbe Foreman, parquée dans ce coin, s'assoit juste à sa droite.
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
        <div ref={rowRef} className="absolute bottom-[calc(1rem+var(--consent-inset))] start-4 z-40 flex items-center gap-2">
            <WorkspaceInbox />
            <GettingStartedPill />
        </div>
    )
}
