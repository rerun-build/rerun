'use client'

import { TemplateDetailPanel } from '@/components/templates/TemplateDetailPanel'
import { TemplateDetailPanelSkeleton } from '@/components/templates/TemplateDetailPanelSkeleton'
import { TemplateLibraryBrowser } from '@/components/templates/TemplateLibraryBrowser'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { useLibraryCreators } from '@/hooks/useLibraryCreators'
import { useLibraryTemplates } from '@/hooks/useLibraryTemplates'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { ChevronLeftIcon, PanelRightCloseIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { TemplateCategory } from '@rerun/contracts'
import { useIsMobile } from '@rerun/ui/primitives'
import { StepTransition } from '@rerun/ui/steps'
import { useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

type LibrarySelection = { kind: 'template'; slug: string } | null

export function TemplateLibraryDialog({
    open,
    onOpenChange,
    priorityCategory,
    preferredConnectorSlugs,
    initialSlug,
    onCreateFromScratch,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    priorityCategory?: TemplateCategory | null
    preferredConnectorSlugs?: string[]
    initialSlug?: string | null
    onCreateFromScratch: () => void
}) {
    const t = useTranslations('templates.library')
    const isAdmin = useIsAdmin()
    const reduceMotion = useReducedMotion() ?? false

    const templates = useLibraryTemplates(open)
    const directory = useLibraryCreators(open)
    const [selection, setSelection] = useState<LibrarySelection>(null)
    const [view, setView] = useState<'list' | 'detail'>('list')
    const isMobile = useIsMobile()
    const signals = useMemo(() => ({ category: priorityCategory, connectorSlugs: preferredConnectorSlugs }), [priorityCategory, preferredConnectorSlugs])
    const [openCount, setOpenCount] = useState(0)
    const [now, setNow] = useState(() => new Date())

    const selected = useMemo(() => (selection?.kind === 'template' ? ((templates ?? []).find(t => t.slug === selection.slug) ?? null) : null), [templates, selection])
    const showDetail = selection !== null
    const [lastSelected, setLastSelected] = useState(selected)
    if (selected && selected !== lastSelected) setLastSelected(selected)
    const shown = selected ?? (showDetail ? null : lastSelected)

    const [wasOpen, setWasOpen] = useState(false)
    if (open !== wasOpen) {
        setWasOpen(open)
        if (open) {
            setSelection(initialSlug ? { kind: 'template', slug: initialSlug } : null)
            setView(initialSlug ? 'detail' : 'list')
            setOpenCount(count => count + 1)
            setNow(new Date())
        }
    }

    const listRef = useRef<HTMLDivElement>(null)
    const detailRef = useRef<HTMLDivElement>(null)
    const shownView = useRef(view)
    useEffect(() => {
        if (shownView.current === view) return
        shownView.current = view
        if (!isMobile) return
        ;(view === 'detail' ? detailRef : listRef).current?.focus()
    }, [view, isMobile])

    function select(next: LibrarySelection) {
        setSelection(next)
        setView('detail')
    }

    function collapseDetail() {
        setSelection(null)
        setView('list')
        listRef.current?.focus()
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="gap-0 overflow-hidden p-0 max-sm:h-dvh sm:max-w-[min(96rem,calc(100%-2rem))] lg:max-w-[min(96rem,calc(100%-8rem))]"
                onEscapeKeyDown={event => {
                    if (!isMobile || view === 'list') return
                    event.preventDefault()
                    setView('list')
                }}
            >
                <DialogTitle className="sr-only">{t('title')}</DialogTitle>

                <div
                    className={cn(
                        'flex min-h-0 flex-1 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                        'sm:grid sm:h-[min(56rem,92dvh)] lg:h-[min(56rem,calc(100dvh-6rem))]',
                        reduceMotion ? 'sm:transition-none' : 'sm:transition-[grid-template-columns]',
                        showDetail ? 'sm:grid-cols-[minmax(0,1fr)_420px]' : 'sm:grid-cols-[minmax(0,1fr)_0px]',
                        view === 'detail' && 'max-sm:-translate-x-full',
                    )}
                >
                    <div
                        ref={listRef}
                        tabIndex={-1}
                        inert={isMobile && view === 'detail'}
                        className="flex w-full min-h-0 min-w-0 shrink-0 outline-none max-sm:pb-[env(safe-area-inset-bottom)] sm:w-auto"
                    >
                        <TemplateLibraryBrowser
                            key={openCount}
                            templates={templates}
                            directory={directory}
                            isAdmin={isAdmin}
                            signals={signals}
                            now={now}
                            selectedSlug={selection?.kind === 'template' ? selection.slug : null}
                            onSelectTemplate={slug => select({ kind: 'template', slug })}
                            onScratch={onCreateFromScratch}
                        />
                    </div>

                    <div ref={detailRef} tabIndex={-1} inert={isMobile ? view === 'list' : !showDetail} className="flex w-full min-h-0 min-w-0 shrink-0 flex-col outline-none sm:w-auto sm:overflow-hidden">
                        <div className="relative flex w-full min-h-0 flex-1 flex-col border-l max-sm:border-l-0 sm:w-[420px] sm:bg-muted/20 sm:shadow-[inset_2px_0_4px_0_rgb(0_0_0/0.05)]">
                            <div className="flex shrink-0 items-center border-b px-2 py-1.5 sm:hidden">
                                <Button type="button" variant="ghost" size="sm" className="gap-1.5 pl-1.5" onClick={() => setView('list')}>
                                    <ChevronLeftIcon className="size-4" />
                                    {t('templates')}
                                </Button>
                            </div>

                            <span className="absolute top-2 left-2 z-20 flex rounded-md bg-background/70 backdrop-blur max-sm:hidden">
                                <TooltipLabeled label={t('hideDetails')} side="bottom">
                                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t('hideDetails')} onClick={collapseDetail}>
                                        <PanelRightCloseIcon />
                                    </Button>
                                </TooltipLabeled>
                            </span>

                            <StepTransition stepKey={shown?.slug ?? 'empty'} direction={1} className="flex min-h-0 flex-1 flex-col">
                                {shown ? (
                                    <TemplateDetailPanel template={shown} showStatus={isAdmin || shown.isMine} onImported={() => onOpenChange(false)} />
                                ) : (
                                    <TemplateDetailPanelSkeleton />
                                )}
                            </StepTransition>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
