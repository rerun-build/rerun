'use client'

import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import { useCallback, useEffect, useRef } from 'react'

import { SIDE_PANEL_WIDTH, clampSidePanelWidth, getSidePanelMaxWidth, loadSidePanelWidth, saveSidePanelWidth, type PanelWidthConfig } from '@/lib/side-panel-width'
import { GripVerticalIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

const KEYBOARD_RESIZE_STEP = 32

type DragState = {
    pointerId: number
    startX: number
    startWidth: number
    currentWidth: number
}

type DocumentStyles = {
    cursor: string
    userSelect: string
}

// The grip on a panel's left edge. `config` and `widthVar` say which panel: the board's side panel by
// default, whose width the agent panel and every other side panel share.
export function SidePanelResizeHandle({ panelRef, config = SIDE_PANEL_WIDTH, widthVar = '--side-panel-width', className }: { panelRef: RefObject<HTMLElement | null>; config?: PanelWidthConfig; widthVar?: string; className?: string }) {
    const t = useTranslations('layout.sidePanel')
    const handleRef = useRef<HTMLDivElement>(null)
    const dragRef = useRef<DragState | null>(null)
    const documentStylesRef = useRef<DocumentStyles | null>(null)

    const syncAria = useCallback((width: number) => {
        const handle = handleRef.current
        if (!handle) return
        handle.setAttribute('aria-valuemin', String(config.min))
        handle.setAttribute('aria-valuemax', String(getSidePanelMaxWidth(window.innerWidth, config)))
        handle.setAttribute('aria-valuenow', String(Math.round(width)))
    }, [config])

    const applyWidth = useCallback((width: number) => {
        const clamped = clampSidePanelWidth(width, window.innerWidth, config)
        panelRef.current?.style.setProperty(widthVar, `${clamped}px`)
        syncAria(clamped)
        return clamped
    }, [panelRef, syncAria, config, widthVar])

    const restoreDocumentStyles = useCallback(() => {
        if (!documentStylesRef.current) return
        document.body.style.cursor = documentStylesRef.current.cursor
        document.body.style.userSelect = documentStylesRef.current.userSelect
        documentStylesRef.current = null
    }, [])

    const finishResize = useCallback((pointerId: number, persist = true) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== pointerId) return

        dragRef.current = null
        const handle = handleRef.current
        handle?.setAttribute('data-dragging', 'false')
        if (handle?.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
        restoreDocumentStyles()

        if (persist) saveSidePanelWidth(drag.currentWidth, window.innerWidth, config)
    }, [restoreDocumentStyles, config])

    useEffect(() => {
        applyWidth(loadSidePanelWidth(window.innerWidth, config))
        const mountedHandle = handleRef.current

        let frame: number | null = null
        const syncRenderedWidth = () => {
            if (frame !== null) cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
                frame = null
                const panel = panelRef.current
                if (panel) syncAria(panel.getBoundingClientRect().width)
            })
        }
        const syncStoredWidth = (event: StorageEvent) => {
            if (event.key === config.storageKey) {
                applyWidth(loadSidePanelWidth(window.innerWidth, config))
            }
        }

        window.addEventListener('resize', syncRenderedWidth)
        window.addEventListener('storage', syncStoredWidth)
        return () => {
            window.removeEventListener('resize', syncRenderedWidth)
            window.removeEventListener('storage', syncStoredWidth)
            if (frame !== null) cancelAnimationFrame(frame)

            const drag = dragRef.current
            if (drag) {
                saveSidePanelWidth(drag.currentWidth, window.innerWidth, config)
                if (mountedHandle?.hasPointerCapture(drag.pointerId)) mountedHandle.releasePointerCapture(drag.pointerId)
                dragRef.current = null
            }
            restoreDocumentStyles()
        }
    }, [applyWidth, panelRef, restoreDocumentStyles, syncAria, config])

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || dragRef.current) return
        const panel = panelRef.current
        if (!panel) return

        event.preventDefault()
        const startWidth = panel.getBoundingClientRect().width
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth,
            currentWidth: startWidth,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.setAttribute('data-dragging', 'true')

        documentStylesRef.current = {
            cursor: document.body.style.cursor,
            userSelect: document.body.style.userSelect,
        }
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return

        const nextWidth = drag.startWidth + drag.startX - event.clientX
        drag.currentWidth = applyWidth(nextWidth)
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const panel = panelRef.current
        if (!panel) return

        const currentWidth = panel.getBoundingClientRect().width
        let nextWidth: number | null = null
        if (event.key === 'ArrowLeft') nextWidth = currentWidth + KEYBOARD_RESIZE_STEP
        if (event.key === 'ArrowRight') nextWidth = currentWidth - KEYBOARD_RESIZE_STEP
        if (event.key === 'Home') nextWidth = config.min
        if (event.key === 'End') nextWidth = getSidePanelMaxWidth(window.innerWidth, config)
        if (nextWidth === null) return

        event.preventDefault()
        saveSidePanelWidth(applyWidth(nextWidth), window.innerWidth, config)
    }

    const resetWidth = () => {
        saveSidePanelWidth(applyWidth(config.defaultWidth), window.innerWidth, config)
    }

    return (
        <div
            ref={handleRef}
            role="separator"
            aria-label={t('resize')}
            aria-orientation="vertical"
            aria-valuemin={config.min}
            data-dragging="false"
            tabIndex={0}
            className={cn('group absolute inset-y-0 -left-[9px] z-10 hidden w-4 cursor-col-resize touch-none focus-visible:outline-none md:block', className)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={event => finishResize(event.pointerId)}
            onPointerCancel={event => finishResize(event.pointerId)}
            onLostPointerCapture={event => finishResize(event.pointerId)}
            onKeyDown={handleKeyDown}
            onDoubleClick={resetWidth}
        >
            <span className="absolute top-1/2 left-1/2 flex h-9 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border/50 bg-background/85 text-muted-foreground shadow-sm backdrop-blur-xl transition-colors duration-200 group-hover:bg-accent group-hover:text-foreground group-focus-visible:bg-accent group-focus-visible:text-foreground group-focus-visible:ring-2 group-focus-visible:ring-ring/40 group-data-[dragging=true]:bg-accent group-data-[dragging=true]:text-foreground">
                <GripVerticalIcon className="size-3" />
            </span>
        </div>
    )
}
