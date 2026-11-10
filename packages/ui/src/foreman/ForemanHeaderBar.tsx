'use client'

import type { PointerEvent, ReactNode } from 'react'

import { cn } from '../cn'
import { PanelLeftCloseIcon, PanelRightCloseIcon, XIcon } from '../icons'
import { Button } from '../primitives'
import { TooltipDisabledReason, TooltipLabeled } from '../Tooltip'
import { HEADER_ORB_SIZE } from './constants'
import { Orb, type OrbActivity } from './Orb'
import { useKitTranslations } from '../locale'

// Le voile déborde sous la barre et s'évanouit : une coupure nette redeviendrait une barre.
const VEIL_MASK = 'linear-gradient(to bottom, black 55%, transparent)'

export type ForemanAnchor = 'dock-left' | 'dock-right' | 'float'

const CLOSE_ICONS = { 'dock-left': PanelLeftCloseIcon, 'dock-right': PanelRightCloseIcon, float: XIcon } as const

export type ForemanHeaderBarProps = {
    anchor: ForemanAnchor
    orbState: OrbActivity
    /** Gèle l'orbe tant que la colonne est repliée : elle est montée bien avant qu'on l'ouvre. */
    orbPaused?: boolean
    onClose: () => void
    /** Le tunnel d'onboarding vit dans la colonne : tant qu'il dure, elle ne se referme pas. */
    closeDisabledReason?: string
    /** Sous `md`, quand une grande orbe tient déjà la sheet juste en dessous. */
    orbHiddenOnSheet?: boolean
    /** Docké sur la gouttière de l'app (`bg-frame`), là où le panneau sombre est transparent. */
    onGutter?: boolean
    actions?: ReactNode
    tabs?: ReactNode
    /** Sans elle, la barre n'est pas une poignée : ni grab, ni grabber de sheet. */
    onDragPointerDown?: (event: PointerEvent<HTMLElement>) => void
    onToggleSheetDetent?: () => void
}

/**
 * Posé par-dessus la pile, sur un voile flouté qui s'évanouit vers le bas plutôt qu'une barre
 * opaque : les vieux messages continuent de se dissoudre dessous, mais les contrôles se détachent.
 */
export function ForemanHeaderBar({ anchor, orbState, orbPaused = false, onClose, closeDisabledReason, orbHiddenOnSheet = false, onGutter = false, actions, tabs, onDragPointerDown, onToggleSheetDetent }: ForemanHeaderBarProps) {
    const t = useKitTranslations()
    const DesktopCloseIcon = CLOSE_ICONS[anchor]
    const draggable = Boolean(onDragPointerDown)
    const closeButton = (
        <Button variant="ghost" size="icon-sm" aria-label={t('foreman.header.closeChat')} disabled={Boolean(closeDisabledReason)} onClick={onClose}>
            {/* Replier un panneau latéral ne veut rien dire quand la conversation est
                une sheet, ni quand elle flotte : là c'est une croix. */}
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
                    // Docké en sombre, le panneau est transparent sur la gouttière : un voile couleur page s'y lirait comme une bande.
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
                        // Pas sur une sheet : un écran tactile n'ouvre pas le tooltip, il ne
                        // resterait qu'une croix grisée sans raison.
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
                    {/* La bête déployée. Elle n'est pas la cible qui referme le chat — le bouton d'à
                        côté et Escape sont les deux seules sorties, hors tunnel — donc elle reste décorative et hors
                        de l'ordre de tabulation. */}
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
