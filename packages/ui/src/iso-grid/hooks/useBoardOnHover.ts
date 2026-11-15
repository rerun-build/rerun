'use client'

import { useIsMobile } from '../../primitives/use-is-mobile'
import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FocusEvent as ReactFocusEvent, PointerEvent as ReactPointerEvent } from 'react'

const INTENT_DELAY = 260

export function useBoardOnHover(available: boolean) {
    const reduceMotion = useReducedMotion() ?? false
    const isMobile = useIsMobile()
    const enabled = available && !reduceMotion && !isMobile

    const [live, setLive] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

    const stop = useCallback(() => {
        clearTimeout(timer.current)
        setLive(false)
    }, [])

    useEffect(() => () => clearTimeout(timer.current), [])

    const start = useCallback(() => {
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setLive(true), INTENT_DELAY)
    }, [])

    const handlers = enabled
        ? {
              onPointerEnter: (event: ReactPointerEvent) => {
                  if (event.pointerType !== 'mouse') return
                  start()
              },
              onPointerLeave: stop,
              onFocus: (event: ReactFocusEvent<HTMLElement>) => {
                  if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) start()
              },
              onBlur: stop,
          }
        : {}

    return { live: enabled && live, handlers }
}
