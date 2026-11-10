'use client'

import { ChromeBar, ChromeButton, ChromeDivider } from './chrome/ChromeSurface'
import { TooltipLabeled } from './Tooltip'
import { cn } from './cn'
import { FocusCenterIcon, MinusIcon, PlusIcon } from './icons'
import { useKitTranslations } from './locale'

export type CanvasViewControlsPlacement = 'bottom-right' | 'top-right'

type CanvasViewControlsProps = {
    onZoomIn: () => void
    onZoomOut: () => void
    onRecenter: () => void
    placement?: CanvasViewControlsPlacement
    className?: string
}

// Assise sur l'inset de la bannière de consentement (0px sans bannière), comme les sheets : en
// mobile elle est `fixed bottom-0` et recouvrirait la moitié de la pill. En haut, rien à éviter.
const PLACEMENT: Record<CanvasViewControlsPlacement, string> = {
    'bottom-right': 'bottom-[calc(1rem+var(--consent-inset))] right-4',
    'top-right': 'top-4 right-4',
}

// Pill verticale (zoom in / zoom out / recentrer) partagée par l'iso board et le dashboard.
// Même design que ModeSwitcher/WorkspaceSwitcher (beam non animé) ; tooltips instantanés (delay 0).
export function CanvasViewControls({ onZoomIn, onZoomOut, onRecenter, placement = 'bottom-right', className }: CanvasViewControlsProps) {
    const t = useKitTranslations()
    return (
        <ChromeBar orientation="vertical" className={cn('absolute z-40', PLACEMENT[placement], className)}>
            <TooltipLabeled label={t('canvas.zoomIn')} side="left">
                <ChromeButton aria-label={t('canvas.zoomIn')} icon={PlusIcon} onPointerDown={e => e.stopPropagation()} onClick={onZoomIn} />
            </TooltipLabeled>
            <TooltipLabeled label={t('canvas.zoomOut')} side="left">
                <ChromeButton aria-label={t('canvas.zoomOut')} icon={MinusIcon} onPointerDown={e => e.stopPropagation()} onClick={onZoomOut} />
            </TooltipLabeled>
            <ChromeDivider orientation="horizontal" />
            <TooltipLabeled label={t('canvas.recenter')} side="left">
                <ChromeButton aria-label={t('canvas.recenterView')} icon={FocusCenterIcon} onPointerDown={e => e.stopPropagation()} onClick={onRecenter} />
            </TooltipLabeled>
        </ChromeBar>
    )
}
