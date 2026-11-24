'use client'

import { useUiDirection } from '../locale'
import type { TextDirection } from '@rerun/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'

export type ScrollFadeOptions = {
    fadeSize?: number
    /** `x` pour une rangée qui défile à l'horizontale : le fondu se pose alors à gauche et à droite. */
    axis?: 'x' | 'y'
    /** Recolle le défilement au bas quand le contenu grandit sous un lecteur qui y était déjà. */
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

/**
 * Le masque d'un conteneur qui défile : un fondu en haut tant qu'il reste du contenu au-dessus, un
 * autre en bas tant qu'il en reste en dessous, et aucun masque du tout quand tout tient dans la
 * boîte — poser un masque inconditionnel ronge le premier et le dernier élément alors qu'il n'y a
 * rien à dissoudre. Un fondu ne couvre jamais plus que le contenu qui a déjà défilé, la marge
 * intérieure du contenu n'en fait pas partie : une conversation collée en bas qui ne déborde que de
 * son padding laisse son premier message net.
 *
 * L'élément est passé en état, pas en ref : il arrive parfois d'une librairie qui possède le
 * conteneur, et un `ref.current` lu une fois au montage manquerait celui qui n'est pas encore là.
 */
export function useScrollEdges(element: HTMLElement | null, { fadeSize = 24, axis = 'y', pinBottom = false }: ScrollFadeOptions = {}) {
    const atBottomRef = useRef(true)
    const [fade, setFade] = useState({ top: 0, bottom: 0 })

    const update = useCallback(() => {
        if (!element) return
        const scrolled = axis === 'x' ? Math.abs(element.scrollLeft) : element.scrollTop
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
        // Le conteneur ET son contenu : le masque se recalcule quand la boîte est redimensionnée
        // comme quand le contenu grandit dessous, ce que fait une réponse en train de s'écrire.
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

export function scrollFadeMask(fade: { top: number; bottom: number }, axis: 'x' | 'y' = 'y', direction: TextDirection = 'ltr') {
    const stops = [fade.top ? `transparent, black ${fade.top}px` : 'black', fade.bottom ? `black calc(100% - ${fade.bottom}px), transparent` : 'black'].join(', ')

    return fade.top || fade.bottom ? `linear-gradient(${axis === 'y' ? 'to bottom' : direction === 'rtl' ? 'to left' : 'to right'}, ${stops})` : undefined
}

export function useScrollFade(element: HTMLElement | null, options: ScrollFadeOptions = {}) {
    const direction = useUiDirection()
    return scrollFadeMask(useScrollEdges(element, options), options.axis, direction)
}
