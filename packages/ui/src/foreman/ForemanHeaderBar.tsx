'use client'

import type { PointerEvent, ReactNode } from 'react'

import { cn } from '../cn'
import { PanelLeftCloseIcon, PanelRightCloseIcon, XIcon } from '../icons'
import { Button } from '../primitives'
import { TooltipDisabledReason, TooltipLabeled } from '../Tooltip'
import { HEADER_ORB_SIZE } from './constants'
import { Orb, type OrbActivity } from './Orb'
import { useKitTranslations } from '../locale'

const VEIL_MASK = 'linear-gradient(to bottom, black 55%, transparent)'

export type ForemanAnchor = 'dock-left' | 'dock-right' | 'float'

const CLOSE_ICONS = { 'dock-left': PanelLeftCloseIcon, 'dock-right': PanelRightCloseIcon, float: XIcon } as const

export type ForemanHeaderBarProps = {
    anchor: ForemanAnchor
    orbState: OrbActivity
    orbPaused?: boolean
    onClose: () => void
    closeDisabledReason?: string
    orbHiddenOnSheet?: boolean
    onGutter?: boolean
    actions?: ReactNode
    tabs?: ReactNode
    onDragPointerDown?: (event: PointerEvent<HTMLElement>) => void
    onToggleSheetDetent?: () => void
}

export function ForemanHeaderBar({ anchor, orbState, orbPaused = false, onClose, closeDisabledReason, orbHiddenOnSheet = false, onGutter = false, actions, tabs, onDragPointerDown, onToggleSheetDetent }: ForemanHeaderBarProps) {
    const t = useKitTranslations()
    const DesktopCloseIcon = CLOSE_ICONS[anchor]
    const draggable = Boolean(onDragPointerDown)
    const closeButton = (
        <Button variant="ghost" size="icon-sm" aria-label={t('foreman.header.closeChat')} disabled={Boolean(closeDisabledReason)} onClick={onClose}>
            <DesktopCloseIcon className="size-3.5 max-md:hidden" />
            <XIcon className="size-3.5 md:hidden" />
        </Button>
    )

    return (
        <div onPointerDown={onDragPointerDown} className={cn('absolute inset-x-0 top-0 z-20 flex flex-col', draggable && 'touch-none md:cursor-grab')}>
            <div
                aria-hidden
                className={cn(
                    'pointer-events-none absolute inset-x-0 top-0 -bottom-6 -z-10 bg-background/70 backdrop-blur-md',
                    anchor !== 'float' && onGutter && 'dark:md:bg-frame/70'
                )}
                style={{ maskImage: VEIL_MASK, WebkitMaskImage: VEIL_MASK }}
            />
            {draggable && <div aria-hidden className="pointer-events-none absolute top-1 left-1/2 hidden h-1 w-8 -translate-x-1/2 rounded-full bg-muted-foreground/25 md:block" />}
            {onToggleSheetDetent && (
                <button
                    type="button"
                    data-sheet-grabber
                    aria-label={t('foreman.header.resize')}
                    onClick={onToggleSheetDetent}
                    className="absolute top-0 left-1/2 flex h-5 w-12 -translate-x-1/2 justify-center pt-1 outline-none focus-visible:[&>span]:bg-ring md:hidden"
                >
                    <span className="h-1 w-8 rounded-full bg-muted-foreground/25" />
                </button>
            )}
            <div className="flex min-h-11 items-center justify-between px-3 py-2">
                <div className="flex items-center gap-3">
                    {closeDisabledReason ? (
                        <div className="max-md:hidden">
                            <TooltipDisabledReason reason={closeDisabledReason} side="bottom">
                                {closeButton}
                            </TooltipDisabledReason>
                        </div>
                    ) : (
                        <TooltipLabeled label={t('close')} side="bottom">
                            {closeButton}
                        </TooltipLabeled>
                    )}
                    <div className={cn(orbHiddenOnSheet && 'max-md:hidden')}>
                        <Orb size={HEADER_ORB_SIZE} state={orbState} paused={orbPaused} facing="right" />
                    </div>
                </div>
                {actions && <div className="flex items-center gap-1.5">{actions}</div>}
            </div>
            {tabs}
        </div>
    )
}
