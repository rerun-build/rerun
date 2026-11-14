'use client'

import { useCallback, useState } from 'react'

export function useDialogPortalContainer<T extends HTMLElement>() {
    const [container, setContainer] = useState<HTMLElement | null>(null)
    const ref = useCallback((node: T | null) => setContainer(node?.closest<HTMLElement>('[data-slot="dialog-content"]') ?? null), [])
    return [ref, container] as const
}
