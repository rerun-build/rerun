'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type ScrollFadeOptions = {
    fadeSize?: number
    axis?: 'x' | 'y'
    pinBottom?: boolean
}

const EDGE_THRESHOLD = 4

function clampEdge(hidden: number, size: number) {
    return hidden <= EDGE_THRESHOLD ? 0 : Math.min(Math.round(hidden), size)
}

function contentPadding(content: Element | null, axis: 'x' | 'y'): [number, number] {
    if (!content) return [0, 0]
    const style = getComputedStyle(content)
    return axis === 'x' ? [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)] : [parseFloat(style.paddingTop), parseFloat(style.paddingBottom)]
}

export function useScrollEdges(element: HTMLElement | null, { fadeSize = 24, axis = 'y', pinBottom = false }: ScrollFadeOptions = {}) {
    const atBottomRef = useRef(true)
    const [fade, setFade] = useState({ top: 0, bottom: 0 })

    const update = useCallback(() => {
        if (!element) return
        const scrolled = axis === 'x' ? element.scrollLeft : element.scrollTop
        const remaining = axis === 'x' ? element.scrollWidth - element.clientWidth - scrolled : element.scrollHeight - element.clientHeight - scrolled
        const [padStart, padEnd] = contentPadding(element.firstElementChild, axis)
        const top = clampEdge(scrolled - padStart, fadeSize)
        const bottom = clampEdge(remaining - padEnd, fadeSize)
        atBottomRef.current = remaining <= EDGE_THRESHOLD
        setFade(prev => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }))
    }, [element, axis, fadeSize])

    useEffect(() => {
        if (!element) return
        const onResize = () => {
            if (pinBottom && atBottomRef.current) element.scrollTop = element.scrollHeight
            update()
        }
        onResize()
        element.addEventListener('scroll', update, { passive: true })
        const observer = new ResizeObserver(onResize)
        observer.observe(element)
        if (element.firstElementChild) observer.observe(element.firstElementChild)
        return () => {
            element.removeEventListener('scroll', update)
            observer.disconnect()
        }
    }, [element, pinBottom, update])

    return fade
}

export function scrollFadeMask(fade: { top: number; bottom: number }, axis: 'x' | 'y' = 'y') {
    const stops = [fade.top ? `transparent, black ${fade.top}px` : 'black', fade.bottom ? `black calc(100% - ${fade.bottom}px), transparent` : 'black'].join(', ')

    return fade.top || fade.bottom ? `linear-gradient(${axis === 'x' ? 'to right' : 'to bottom'}, ${stops})` : undefined
}

export function useScrollFade(element: HTMLElement | null, options: ScrollFadeOptions = {}) {
    return scrollFadeMask(useScrollEdges(element, options), options.axis)
}
