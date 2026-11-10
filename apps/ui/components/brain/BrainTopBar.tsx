'use client'

import { Button } from '@/components/ui/button'
import { ChevronRightIcon, PanelLeftIcon, XIcon, type LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { createContext, Fragment, useContext, type ReactNode } from 'react'

type BrainChrome = { onClose: () => void; onToggleSidebar: (() => void) | null }

export const BrainChromeContext = createContext<BrainChrome>({ onClose: () => {}, onToggleSidebar: null })

export type BrainCrumb = { label: string; icon?: LucideIcon; onClick?: () => void }

// The bar on top of whatever the sidebar opened: where it sits, how its save is going, what can be
// done with it, and the way out of the dialog.
export function BrainTopBar({ crumbs, status, children }: { crumbs: BrainCrumb[]; status?: ReactNode; children?: ReactNode }) {
    const t = useTranslations('brain.topBar')
    const { onClose, onToggleSidebar } = useContext(BrainChromeContext)

    return (
        <div className="flex h-12 shrink-0 items-center gap-2 px-3">
            {onToggleSidebar && (
                <Button size="icon-sm" variant="ghost" onClick={onToggleSidebar} aria-label={t('showSidebar')} title={t('showSidebar')}>
                    <PanelLeftIcon />
                </Button>
            )}
            <nav aria-label={t('breadcrumb')} className="flex min-w-0 flex-1 items-center gap-1 text-sm">
                {crumbs.map((crumb, index) => {
                    const last = index === crumbs.length - 1
                    const Glyph = crumb.icon
                    const content = (
                        <>
                            {Glyph && <Glyph className="size-3.5 shrink-0 text-muted-foreground" />}
                            <span className="truncate">{crumb.label}</span>
                        </>
                    )
                    return (
                        <Fragment key={index}>
                            {index > 0 && <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/60" />}
                            {crumb.onClick && !last ? (
                                <button type="button" onClick={crumb.onClick} className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                                    {content}
                                </button>
                            ) : (
                                <span className={cn('flex min-w-0 items-center gap-1.5 px-1.5 py-1', last ? 'text-foreground' : 'text-muted-foreground')}>{content}</span>
                            )}
                        </Fragment>
                    )
                })}
            </nav>
            {status && <div className="shrink-0 text-xs text-muted-foreground max-sm:hidden">{status}</div>}
            {children && <div className="flex shrink-0 items-center gap-0.5">{children}</div>}
            <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label={t('close')} title={t('close')}>
                <XIcon />
            </Button>
        </div>
    )
}
