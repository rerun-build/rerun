'use client'

import { SidePanelResizeHandle } from '@/components/layout/SidePanelResizeHandle'
import { TooltipDisabledReason, TooltipLabeled } from '@/components/ui/tooltip'
import { useSheetResize } from '@/components/layout/useSheetResize'
import { SIDE_PANEL_DEFAULT_WIDTH, loadSidePanelSheetDetent, rememberSidePanelSheetDetent } from '@/lib/side-panel-width'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { type ComponentProps, type CSSProperties, type ReactNode, useRef } from 'react'

/**
 * À partir de `md`, un panneau qui glisse depuis la droite du board. En dessous, une sheet qui monte
 * du bas comme celle du Foreman : tirée par sa poignée ou son en-tête d'un cran à l'autre ou jusqu'à
 * la fermeture (voir `useSheetResize`), le board reste vivant au-dessus. Le rail n'y existe pas :
 * `mobileBar` s'ancre tout en haut, sous la poignée, et `mobileHeader` remplace `header` juste dessous.
 * Sans en-tête, seule la poignée tire la sheet.
 */
export function SidePanel({
    isOpen,
    onDismiss,
    header,
    mobileHeader,
    mobileBar,
    rail,
    children,
}: {
    isOpen: boolean
    onDismiss: () => void
    header?: ReactNode
    mobileHeader?: ReactNode
    mobileBar?: ReactNode
    rail?: ReactNode
    children: ReactNode
}) {
    const panelRef = useRef<HTMLDivElement>(null)
    const t = useTranslations('layout.sidePanel')
    const { onPointerDown, toggleDetent } = useSheetResize({
        panelRef,
        dragVar: '--side-sheet-drag-h',
        detentVar: '--side-sheet-detent-h',
        loadDetent: loadSidePanelSheetDetent,
        rememberDetent: rememberSidePanelSheetDetent,
        onDismiss,
    })

    return (
        <div
            ref={panelRef}
            data-side-panel
            className={cn(
                'absolute inset-0 z-50 flex w-full flex-col transition-transform duration-300 ease-in-out md:top-2 md:right-2 md:bottom-2 md:left-auto md:w-(--side-panel-width) md:min-w-[480px] md:max-w-[min(800px,60vw)]',
                'md:rounded-xl md:border md:border-border md:bg-background md:shadow-[0_8px_24px_-10px_rgb(0_0_0/0.28)]',
                'max-md:top-auto max-md:h-[var(--side-sheet-drag-h,var(--side-sheet-detent-h,calc(96dvh-env(safe-area-inset-top))))] max-md:max-h-[calc(96dvh-env(safe-area-inset-top))] max-md:overflow-hidden max-md:rounded-t-2xl max-md:border-t max-md:border-border max-md:bg-background max-md:pb-[var(--consent-inset)] max-md:shadow-2xl',
                'max-md:transition-[translate,height] max-md:duration-500 max-md:ease-[cubic-bezier(0.32,0.72,0,1)] max-md:data-[sheet-dragging]:max-h-none max-md:data-[sheet-dragging]:transition-none',
                !isOpen && 'max-md:translate-y-full md:translate-x-[calc(100%_+_32px)]'
            )}
            style={{ '--side-panel-width': `${SIDE_PANEL_DEFAULT_WIDTH}px` } as CSSProperties}
        >
            {isOpen && <SidePanelResizeHandle panelRef={panelRef} />}
            <button
                type="button"
                data-sheet-grabber
                aria-label={t('resize')}
                onPointerDown={onPointerDown}
                onClick={toggleDetent}
                className="absolute top-0 left-1/2 z-10 flex h-4 w-12 -translate-x-1/2 touch-none justify-center pt-1.5 outline-none focus-visible:[&>span]:bg-ring md:hidden"
            >
                <span className="h-1 w-8 rounded-full bg-muted-foreground/25" />
            </button>
            {/* clip-path, not overflow alone: the top veil's backdrop-filter bleeds square past rounded corners. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[inherit] md:flex-row md:[clip-path:inset(0_round_13px)]">
                <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col bg-background">
                    <div onPointerDown={onPointerDown} className="max-md:touch-none">
                        {mobileBar && <div className="pb-1 pt-5 md:hidden">{mobileBar}</div>}
                        <div className="max-md:hidden">{header}</div>
                        <div className="md:hidden">{mobileHeader}</div>
                    </div>
                    <div data-side-panel-body className="flex-1 min-h-0 overflow-hidden relative">{children}</div>
                </div>

                {rail && <div className="hidden flex-col items-center gap-1 border-l border-border bg-background px-1.5 py-4 md:flex">{rail}</div>}
            </div>
        </div>
    )
}

type SidePanelRailButtonProps = ComponentProps<'button'> & { label: string; isActive: boolean; disabledReason?: string | null }

export function SidePanelRailButton({ label, isActive, disabledReason, className, children, ...props }: SidePanelRailButtonProps) {
    if (disabledReason) {
        return (
            <TooltipDisabledReason reason={disabledReason} side="left">
                <button aria-label={label} disabled className={cn('relative p-2 rounded-md shrink-0 text-muted-foreground opacity-50', className)}>
                    {children}
                </button>
            </TooltipDisabledReason>
        )
    }
    return (
        <TooltipLabeled label={label} side="left">
            <button
                aria-label={label}
                className={cn('relative p-2 rounded-md transition-colors shrink-0', isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50', className)}
                {...props}
            >
                {children}
            </button>
        </TooltipLabeled>
    )
}

export function SidePanelRailDivider({ pinBottom = false }: { pinBottom?: boolean }) {
    return <div className={cn('my-1 h-px w-full shrink-0 bg-border', pinBottom && 'mt-auto')} />
}
