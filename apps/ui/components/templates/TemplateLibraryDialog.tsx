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

// The app's recruiting surface: pick a template, then place its captured agents on the board one by
// one. Confirming closes the library rather than reloading it — the rest happens on the grid, and
// the tiles arrive on their own through the realtime subscription on `agents`.
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
    // The connectors the viewer said they use, which rank Discover's picks.
    preferredConnectorSlugs?: string[]
    // A template the opener already picked, which the dialog opens on the detail of rather than on
    // the gallery.
    initialSlug?: string | null
    // The agent with no template goes through the New agent dialog, which the opener owns.
    onCreateFromScratch: () => void
}) {
    const t = useTranslations('templates.library')
    const isAdmin = useIsAdmin()
    const reduceMotion = useReducedMotion() ?? false

    const templates = useLibraryTemplates(open)
    const directory = useLibraryCreators(open)
    const [selection, setSelection] = useState<LibrarySelection>(null)
    // Under sm the two columns become one track the width of two screens that slides between the
    // gallery and the detail. `view` is its own state rather than something derived from
    // `selection`: the dialog opens on a selection nobody made yet, and deriving it would land a
    // phone straight on the detail panel instead of the catalogue.
    const [view, setView] = useState<'list' | 'detail'>('list')
    const isMobile = useIsMobile()
    const signals = useMemo(() => ({ category: priorityCategory, connectorSlugs: preferredConnectorSlugs }), [priorityCategory, preferredConnectorSlugs])
    // Bumped on every open so the browser comes back on Discover with an empty search, rather than
    // on wherever the last visit left it.
    const [openCount, setOpenCount] = useState(0)
    const [now, setNow] = useState(() => new Date())

    // Resolved against the full list, not the filtered one, so a filter change does not drop
    // the panel out from under the selection.
    const selected = useMemo(() => (selection?.kind === 'template' ? ((templates ?? []).find(t => t.slug === selection.slug) ?? null) : null), [templates, selection])
    // On the selection rather than on the resolved template: opening on an `initialSlug` while the
    // catalogue is still coming would otherwise land on the gallery and push the panel open a second
    // later, in front of a viewer who already picked.
    const showDetail = selection !== null
    // The panel keeps drawing the template it was closed on while its column folds away, rather
    // than swapping to its skeleton for the length of the animation.
    const [lastSelected, setLastSelected] = useState(selected)
    if (selected && selected !== lastSelected) setLastSelected(selected)
    const shown = selected ?? (showDetail ? null : lastSelected)

    // Reopening lands on the gallery, unless the opener already picked a template, in which case it
    // lands on that one's detail: coming from a card in the New agent dialog, the gallery would be a
    // step backwards. Adjusted during render rather than in an effect: on open and not on close,
    // because in sheet mode the content stays visible through the dismiss animation and resetting
    // there would slide the gallery back in mid-swipe.
    // Starts false rather than at `open`, so a dialog mounted already open is seeded too instead of
    // landing on the gallery with `initialSlug` ignored.
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
        // The button that was just pressed goes inert with its column.
        listRef.current?.focus()
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* Le gutter large n'arrive qu'à partir de lg : sous 1024px le détail garde ses 420px
                fixes, et chaque rem pris sur les côtés est pris à la colonne des cartes. */}
            <DialogContent
                className="gap-0 overflow-hidden p-0 max-sm:h-dvh sm:max-w-[min(96rem,calc(100%-2rem))] lg:max-w-[min(96rem,calc(100%-8rem))]"
                onEscapeKeyDown={event => {
                    if (!isMobile || view === 'list') return
                    event.preventDefault()
                    setView('list')
                }}
            >
                {/* Outside the track: the visible title lives in the list column, which goes inert
                    on a phone showing the detail, and an inert element cannot name the dialog. */}
                <DialogTitle className="sr-only">{t('title')}</DialogTitle>

                {/* The sheet carries the phone height, not this track: vaul rewrites the sheet's own
                    height when the keyboard opens over the search field, and a track measured in
                    dvh would keep its full height under it and push its bottom row off screen.

                    Two columns on a desktop, one two-screen-wide track on a phone. minmax(0,…)
                    rather than 1fr: the card grid would otherwise impose its intrinsic width on the
                    track and push the detail panel out of the dialog. The overflow-hidden above is
                    what clips the half of the track that sits off screen. */}
                <div
                    className={cn(
                        'flex min-h-0 flex-1 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                        'sm:grid sm:h-[min(56rem,92dvh)] lg:h-[min(56rem,calc(100dvh-6rem))]',
                        // Read from the hook rather than written as `motion-reduce:sm:transition-none`,
                        // whose two variants only sort by source order.
                        reduceMotion ? 'sm:transition-none' : 'sm:transition-[grid-template-columns]',
                        showDetail ? 'sm:grid-cols-[minmax(0,1fr)_420px]' : 'sm:grid-cols-[minmax(0,1fr)_0px]',
                        view === 'detail' && 'max-sm:-translate-x-full',
                    )}
                >
                    {/* inert rather than hidden: the panel off screen keeps its scroll position and
                        its form state, it just has to leave the tab order while it is out there. */}
                    {/* Le `p-0` passé au DialogContent supprime le padding bas safe-area de la
                        sheet : la colonne qui touche le bord bas le reprend elle-même, comme le
                        fait le footer de la colonne détail. */}
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

                    {/* Two elements for one column: the track collapses to nothing until something
                        is picked, and this one clips it, while the panel inside keeps the width it
                        was written for. Measured on the track instead, it would relayout on every
                        frame of the opening. */}
                    <div ref={detailRef} tabIndex={-1} inert={isMobile ? view === 'list' : !showDetail} className="flex w-full min-h-0 min-w-0 shrink-0 flex-col outline-none sm:w-auto sm:overflow-hidden">
                        {/* The border sits here and not on the clipper, which would keep a hairline
                            of it lit against the catalogue while the column is closed. */}
                        <div className="relative flex w-full min-h-0 flex-1 flex-col border-l max-sm:border-l-0 sm:w-[420px] sm:bg-muted/20 sm:shadow-[inset_2px_0_4px_0_rgb(0_0_0/0.05)]">
                            {/* Above the StepTransition, not inside the panels: it would have to be
                                repeated in all three of them, and it would slide away with the step
                                animation every time another template is picked. */}
                            <div className="flex shrink-0 items-center border-b px-2 py-1.5 sm:hidden">
                                <Button type="button" variant="ghost" size="sm" className="gap-1.5 pl-1.5" onClick={() => setView('list')}>
                                    <ChevronLeftIcon className="size-4" />
                                    {t('templates')}
                                </Button>
                            </div>

                            {/* Folds the column away and leaves the library open, which the dialog's
                                own close button does not. A phone has the bar above for that. */}
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
