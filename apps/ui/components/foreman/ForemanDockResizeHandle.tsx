'use client'

import type { PointerEvent, RefObject } from 'react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'

import { type ForemanPlacement, FOREMAN_DOCK_DEFAULT_WIDTH, clampForemanDockWidth } from '@/lib/foreman-layout'
import { cn } from '@/lib/utils'
import { useBoardCoverStore } from '@/stores/board-cover.store'
import { useForemanStore } from '@/stores/foreman.store'

type ResizeState = { pointerId: number; startX: number; startWidth: number; width: number; release: () => void }

/**
 * Le bord intérieur du dock, posé sur la gouttière qui le sépare du board. Pendant le geste la
 * largeur ne passe pas par React : elle s'écrit dans --foreman-dock-w du cadre, que la piste de
 * grille, le panneau et le fantôme lisent tous, et la transition de la piste est coupée pour
 * qu'elle suive le pointeur. Le lâcher la range dans le placement.
 */
export function ForemanDockResizeHandle({ panelRef, placement }: { panelRef: RefObject<HTMLDivElement | null>; placement: ForemanPlacement & { mode: 'dock' } }) {
    const t = useTranslations('foreman')
    const resizeRef = useRef<ResizeState | null>(null)
    const growsLeft = placement.side === 'right'

    const splitOf = () => panelRef.current?.closest<HTMLElement>('[data-foreman-split]') ?? null
    const gridOf = () => panelRef.current?.closest<HTMLElement>('[data-foreman-grid]') ?? null

    useEffect(
        () => () => {
            const resize = resizeRef.current
            if (!resize) return
            resizeRef.current = null
            panelRef.current?.closest<HTMLElement>('[data-foreman-grid]')?.style.removeProperty('transition')
            resize.release()
        },
        [panelRef]
    )

    const commit = (dockWidth: number) => useForemanStore.getState().setPlacement({ ...placement, dockWidth })

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || resizeRef.current) return
        const panel = panelRef.current
        if (!panel) return
        event.preventDefault()
        const width = panel.getBoundingClientRect().width
        resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, width, release: useBoardCoverStore.getState().cover() }
        gridOf()?.style.setProperty('transition', 'none')
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.setAttribute('data-resizing', 'true')
    }

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const resize = resizeRef.current
        if (!resize || resize.pointerId !== event.pointerId) return
        const dx = event.clientX - resize.startX
        resize.width = clampForemanDockWidth(resize.startWidth + (growsLeft ? -dx : dx), window.innerWidth)
        splitOf()?.style.setProperty('--foreman-dock-w', `${resize.width}px`)
    }

    const finishResize = (event: PointerEvent<HTMLDivElement>) => {
        const resize = resizeRef.current
        if (!resize || resize.pointerId !== event.pointerId) return
        resizeRef.current = null
        event.currentTarget.setAttribute('data-resizing', 'false')
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        gridOf()?.style.removeProperty('transition')
        resize.release()
        commit(resize.width)
    }

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('resize')}
            data-resizing="false"
            className={cn(
                'group absolute inset-y-0 z-30 hidden w-2 cursor-col-resize touch-none md:block',
                placement.side === 'right' ? 'left-0' : 'right-0'
            )}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onLostPointerCapture={finishResize}
            onDoubleClick={() => commit(clampForemanDockWidth(FOREMAN_DOCK_DEFAULT_WIDTH, window.innerWidth))}
        >
            {/* Une rainure creusée dans la gouttière plutôt qu'un trait posé dessus : ombre interne en
                haut, liseré clair sous la lèvre du bas, comme la famille relief mais retournée. */}
            <div className="absolute top-1/2 left-1/2 h-16 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/[0.07] opacity-0 shadow-[inset_0_1px_2px_rgb(0_0_0/0.28),0_1px_0_rgb(255_255_255/0.8)] transition-[opacity,height] duration-200 group-hover:opacity-100 group-data-[resizing=true]:h-24 group-data-[resizing=true]:bg-black/[0.12] group-data-[resizing=true]:opacity-100 dark:bg-white/[0.14] dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.9),0_1px_0_rgb(255_255_255/0.16)] dark:group-data-[resizing=true]:bg-white/[0.2]" />
        </div>
    )
}
