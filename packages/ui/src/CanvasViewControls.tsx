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

const PLACEMENT: Record<CanvasViewControlsPlacement, string> = {
    'bottom-right': 'bottom-[calc(1rem+var(--consent-inset))] right-4',
    'top-right': 'top-4 right-4',
}

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
