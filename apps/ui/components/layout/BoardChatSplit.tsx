'use client'

import { useReducedMotion } from 'motion/react'
import { type CSSProperties, useEffect, type ReactNode } from 'react'

import { ForemanColumn } from '@/components/foreman/ForemanColumn'
import { ForemanDropPreview } from '@/components/foreman/ForemanDropPreview'
import { ProviderStatusBanner } from '@/components/layout/ProviderStatusBanner'
import { DEFAULT_FOREMAN_PLACEMENT, type ForemanPlacement, dockedForemanSide, loadForemanPlacement } from '@/lib/foreman-layout'
import { loadForemanOpen } from '@/lib/foreman-open'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'
import { selectForemanVisible, useForemanStore } from '@/stores/foreman.store'

export function BoardChatSplit({ initialOpen, initialPlacement, children }: { initialOpen: boolean | null; initialPlacement: ForemanPlacement | null; children: ReactNode }) {
    const visible = useForemanStore(selectForemanVisible)
    const requested = useForemanStore(state => state.open)
    const resolved = requested ?? initialOpen
    const open = visible ? resolved : false
    const placement = useForemanStore(state => state.placement) ?? initialPlacement ?? DEFAULT_FOREMAN_PLACEMENT
    const dragging = useForemanStore(state => state.dropTarget !== null)
    const docked = dockedForemanSide({ open, placement, dragging })
    const reduceMotion = useReducedMotion()
    const accountSwitches = useForemanStore(state => state.accountSwitches)
    const onboarded = useForemanStore(state => state.funnel === 'companion')

    useEffect(() => {
        useForemanStore.getState().restoreOpen(loadForemanOpen())
        useForemanStore.getState().restorePlacement(loadForemanPlacement())
    }, [])

    useEffect(() => {
        if (!visible) return
        return useBoardStore.subscribe((board, prev) => {
            const sheetOpen = board.selectedAgentId !== null
            const sheetWasOpen = prev.selectedAgentId !== null
            if (sheetOpen === sheetWasOpen) return
            const foreman = useForemanStore.getState()
            if (!sheetOpen) foreman.reclaimFromSheet()
            else if (foreman.open === true && foreman.funnel === 'companion') foreman.yieldToSheet()
        })
    }, [visible])

    return (
        <div
            data-foreman-split
            style={{ '--foreman-dock-w': `${placement.dockWidth}px` } as CSSProperties}
            className="relative h-dvh w-full overflow-hidden p-0 md:p-2 bg-frame flex flex-col [--board-inset:0px] md:[--board-inset:9px] [--foreman-dock-track:min(var(--foreman-dock-w),60vw)]"
        >
            {onboarded && <ProviderStatusBanner />}
            <div
                data-foreman-grid
                className={cn(
                    'grid flex-1 min-h-0 w-full grid-cols-1 grid-rows-[minmax(0,1fr)] duration-300 ease-in-out',
                    visible && (reduceMotion ? 'md:transition-none' : 'md:transition-[grid-template-columns]'),
                    visible &&
                        (docked === 'left'
                            ? 'md:grid-cols-[var(--foreman-dock-track)_minmax(0,1fr)_0px]'
                            : docked === 'right'
                              ? 'md:grid-cols-[0px_minmax(0,1fr)_var(--foreman-dock-track)]'
                              : 'md:grid-cols-[0px_minmax(0,1fr)_0px]')
                )}
            >
                <div className={cn('min-w-0 bg-background md:rounded-3xl md:border md:border-border md:shadow overflow-hidden md:overflow-auto h-full', visible && 'md:col-start-2 md:row-start-1')}>{children}</div>
                <div className={visible ? 'contents' : 'hidden'}>
                    <ForemanColumn key={accountSwitches} open={open} placement={placement} />
                </div>
            </div>
            {visible && <ForemanDropPreview />}
        </div>
    )
}
