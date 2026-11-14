'use client'

import { STORY_ACTION_MS, STORY_CARD_ENTER_MS } from '@rerun/contracts'
import { useEffect, useRef, useState } from 'react'

export function useActionTicker(count: number, playing: boolean, skip: boolean) {
    const [told, setTold] = useState(0)
    const remaining = useRef(STORY_CARD_ENTER_MS + STORY_ACTION_MS)

    useEffect(() => {
        if (skip || !playing || told >= count) return
        const startedAt = performance.now()
        let fired = false
        const timer = window.setTimeout(() => {
            fired = true
            remaining.current = STORY_ACTION_MS
            setTold(current => current + 1)
        }, remaining.current)
        return () => {
            window.clearTimeout(timer)
            if (!fired) remaining.current = Math.max(0, remaining.current - (performance.now() - startedAt))
        }
    }, [skip, playing, told, count])

    return skip ? count : told
}
