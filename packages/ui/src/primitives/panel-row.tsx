import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '../cn'

export const PANEL_CARD = 'rounded-md border border-border bg-muted/20'
export const PANEL_CARD_INTERACTIVE = 'transition-colors hover:bg-accent/30'

type PanelRowProps = {
    title?: ReactNode
    description?: ReactNode
    footer?: ReactNode
    leading?: ReactNode
    meta?: ReactNode
    actions?: ReactNode
    onClick?: () => void
    disabled?: boolean
    className?: string
    children?: ReactNode
}

export function PanelRow({ title, description, footer, leading, meta, actions, onClick, disabled, className, children }: PanelRowProps) {
    const content = (
        <>
            {leading}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {(title || meta) && (
                    <div className={cn('flex items-center gap-2', title && 'justify-between')}>
                        {title && <span className="truncate text-sm font-medium">{title}</span>}
                        {meta && <div className="flex shrink-0 items-center gap-1.5">{meta}</div>}
                    </div>
                )}
                {description && <span className="line-clamp-2 text-xs text-muted-foreground">{description}</span>}
                {footer && <span className="text-[10px] text-muted-foreground">{footer}</span>}
                {children}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </>
    )

    const rootClassName = cn('group flex w-full items-center gap-3 p-3 text-left', PANEL_CARD, onClick && PANEL_CARD_INTERACTIVE, className)

    if (!onClick) return <div className={rootClassName}>{content}</div>

    if (actions) {
        const activate = (e: KeyboardEvent<HTMLDivElement>) => {
            if (disabled || (e.key !== 'Enter' && e.key !== ' ')) return
            e.preventDefault()
            onClick()
        }
        return (
            <div
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-disabled={disabled || undefined}
                onClick={disabled ? undefined : onClick}
                onKeyDown={activate}
                className={cn(rootClassName, 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', disabled && 'opacity-60')}
            >
                {content}
            </div>
        )
    }

    return (
        <button type="button" disabled={disabled} onClick={onClick} className={cn(rootClassName, 'disabled:opacity-60')}>
            {content}
        </button>
    )
}
