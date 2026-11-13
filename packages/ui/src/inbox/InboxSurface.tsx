'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { memo, startTransition, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ComponentType, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { BorderBeam } from '../BorderBeam'
import { CHROME_SIZE, ChromePill } from '../chrome/ChromeSurface'
import { cn } from '../cn'
import { BellIcon, CheckCheckIcon, InboxIcon, Loader2Icon } from '../icons'
import { Button, Chip, EmptyState, useScrollFade } from '../primitives'
import { useKitTranslations, useUiLocale } from '../locale'
import type { KitTranslator } from '../kit-translator'
import { shortRelativeTime } from '../time'
import { TooltipDisabledReason, TooltipLabeled } from '../Tooltip'
import { AgentBuddy } from '../iso-grid/components/buddy/AgentBuddy'
import { ATTENTION_STATUS_META } from './attention'
import { AttentionBuddy } from './AttentionBuddy'

export type InboxEntry = {
    id: string
    agentId: string
    agentName: string
    status: string
    title: string
    /** The question, approval, heads-up or error the agent left for the user, when one was recorded. */
    message: string | null
    updatedAt: string | null
    /** The runs folded into a `done` row, every run of one scheduled task being one row. */
    count?: number
}

export type InboxAnnouncement = {
    key: string
    item: InboxEntry
    /** More than one: the arrivals are announced together, as a count. */
    bundled: number
    /** A loud announcement carries a beam in its status tone. */
    loud: boolean
}

type InboxSection = { key: 'needsYou' | 'headsUps' | 'errors' | 'done'; statuses: string[] }

const SECTIONS: InboxSection[] = [
    { key: 'needsYou', statuses: ['awaiting_question', 'awaiting_approval', 'awaiting_connector', 'waiting_human'] },
    { key: 'headsUps', statuses: ['awaiting_ack'] },
    { key: 'errors', statuses: ['error'] },
    { key: 'done', statuses: ['done'] },
]

const SENTENCE_STATUSES = ['awaiting_question', 'awaiting_approval', 'awaiting_connector', 'waiting_human', 'awaiting_ack', 'error', 'done'] as const
type SentenceStatus = (typeof SENTENCE_STATUSES)[number]

function statusSentence(item: InboxEntry, t: KitTranslator): string {
    const status: SentenceStatus = (SENTENCE_STATUSES as readonly string[]).includes(item.status) ? (item.status as SentenceStatus) : 'waiting_human'
    return t(`inbox.sentences.${status}`, { agent: item.agentName })
}

const PILL_STACK_SIZE = 3

const LIST_DEFAULT_MAX_HEIGHT = 'min(22rem, 50dvh)'
const LIST_MIN_HEIGHT = 160
const LIST_MAX_HEIGHT = 576
// Header, chips and footer of the card, plus the corner row it rises from.
const LIST_CHROME_HEIGHT = 224
const DRAG_THRESHOLD = 3
const KEYBOARD_RESIZE_STEP = 32

const listMaxHeightFor = (height: number | null, fallback: string) =>
    height === null ? fallback : `clamp(${LIST_MIN_HEIGHT}px, ${height}px, min(${LIST_MAX_HEIGHT}px, calc(100dvh - ${LIST_CHROME_HEIGHT}px)))`

export type InboxSurfaceProps<T extends InboxEntry> = {
    items: T[]
    /** One coworker id per conversation still running, for the line above the list. */
    running?: string[]
    open: boolean
    onOpenChange: (open: boolean) => void
    onOpenItem: (item: T) => void
    onMarkRead: (item: T) => void
    onMarkAllRead: () => void
    /** False retire le bouton Préférences : une vitrine n'a pas de réglages à ouvrir, et le laisser
     *  désactivé ne fait qu'ajouter un libellé éteint. */
    showSettings?: boolean
    /** Without it, Preferences stays on show but disabled, with `settingsDisabledReason` as its tooltip. */
    onOpenSettings?: () => void
    settingsDisabledReason?: string
    /** Bumped each time a new item lands: the pill sends out one ring to say so. */
    pulse?: number
    /** Set while a dialog portaled out of the card is up: its clicks and its Escape are its own. */
    keepOpen?: boolean
    resizable?: boolean
    /** Any CSS length, a `var()` included, for a card bounded by something other than the viewport. */
    listMaxHeight?: string
    cardClassName?: string
    /** The arrival the hub announces: one of its rows, perched above the pill until it folds back in. */
    announcement?: InboxAnnouncement | null
    onAnnouncementClick?: () => void
    /** True while the pointer or the focus is on the announcement. */
    onAnnouncementHoldChange?: (held: boolean) => void
    /** Under a row: why it reached you. */
    rowReason?: (item: T) => ReactNode
    /** Beside a row: what can be changed about it, a menu the app brings. A component, not a render function, so the memoised row keeps its props stable. */
    RowMenu?: ComponentType<RowMenuProps<T>>
    /** True while a row's menu is open: it is portaled out of the card, which would otherwise close on its clicks. */
    onRowMenuOpenChange?: (open: boolean) => void
    /** When set, the card rises from the pill around this body instead of the list. */
    detail?: ReactNode
    detailClassName?: string
    /** `pill`: the board's corner, the pill grows into the card. `row`: a line of a list's header, the card drops under it. */
    trigger?: 'pill' | 'row'
}

/**
 * The pill grows into the card and stays on as its footer. Only the pill takes room in the corner row: the
 * open card is laid over it, so opening never shoves the Getting started pill aside.
 */
export function InboxSurface<T extends InboxEntry>({
    items,
    running = [],
    open,
    onOpenChange,
    onOpenItem,
    onMarkRead,
    onMarkAllRead,
    onOpenSettings,
    showSettings = true,
    settingsDisabledReason,
    pulse = 0,
    keepOpen = false,
    resizable = true,
    listMaxHeight: defaultListMaxHeight = LIST_DEFAULT_MAX_HEIGHT,
    cardClassName = 'w-[calc(100vw-2rem)] sm:w-96',
    announcement = null,
    onAnnouncementClick,
    onAnnouncementHoldChange,
    rowReason,
    RowMenu,
    onRowMenuOpenChange,
    detail = null,
    detailClassName = 'w-[calc(100vw-2rem)] sm:w-[340px]',
    trigger = 'pill',
}: InboxSurfaceProps<T>) {
    const t = useKitTranslations()
    const reducedMotion = useReducedMotion()
    const cardId = useId()
    const rootRef = useRef<HTMLDivElement>(null)
    const dropLayerRef = useRef<HTMLDivElement>(null)
    const pillRef = useRef<HTMLButtonElement>(null)
    const [pillWidth, setPillWidth] = useState(0)
    const [listEl, setListEl] = useState<HTMLDivElement | null>(null)
    const [listHeight, setListHeight] = useState<number | null>(null)
    const [dragging, setDragging] = useState(false)
    const dragRef = useRef<{ startY: number; startHeight: number; moved: boolean; height: number | null; frame: number | null } | null>(null)
    const justDraggedRef = useRef(false)
    const [activeSection, setActiveSection] = useState<string | null>(null)
    const mask = useScrollFade(listEl)
    // Closing only starts the card's fold: the pill stays hidden until the card has shrunk back to its
    // size, or both shadows stack up while it folds and the pill's beam pops in over it.
    const hasDetail = detail !== null && detail !== undefined
    const cardOpen = open || hasDetail
    const [cardMounted, setCardMounted] = useState(cardOpen)
    if (cardOpen && !cardMounted) setCardMounted(true)
    const dropAnchor = useDropAnchor(rootRef, trigger === 'row', cardOpen)
    const refocusPillRef = useRef(false)

    useEffect(() => {
        if (cardMounted || !refocusPillRef.current) return
        refocusPillRef.current = false
        pillRef.current?.focus()
    }, [cardMounted])

    // The pill is hidden under the open card: it can only take the focus back once it shows again.
    const closeToPill = () => {
        refocusPillRef.current = true
        onOpenChange(false)
    }

    // Mounting the card and its rows is the heaviest render of the inbox: as a transition it is sliced
    // across frames instead of freezing the one that follows the click.
    const togglePill = () => startTransition(() => onOpenChange(!open))

    // The card opens from, and folds back into, the pill's exact size.
    useEffect(() => {
        const pill = pillRef.current
        if (!pill) return
        const observer = new ResizeObserver(() => setPillWidth(pill.offsetWidth))
        observer.observe(pill)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        if (!cardOpen || keepOpen) return
        const onPointerDown = (event: globalThis.PointerEvent) => {
            const target = event.target as Node
            if (rootRef.current?.contains(target) || dropLayerRef.current?.contains(target)) return
            onOpenChange(false)
        }
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') return
            refocusPillRef.current = true
            onOpenChange(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [cardOpen, keepOpen, onOpenChange])

    const sections = useMemo(
        () => SECTIONS.map(section => ({ ...section, items: items.filter(i => section.statuses.includes(i.status)) })).filter(section => section.items.length > 0),
        [items]
    )
    const sectionKey = sections.map(section => section.key).join(',')

    // A short last section can never reach the top of the list: once scrolled to the bottom, it is the one shown.
    useEffect(() => {
        if (!listEl) return
        const onScroll = () => {
            const nodes = Array.from(listEl.querySelectorAll<HTMLElement>('[data-section]'))
            if (nodes.length === 0) return
            const atBottom = listEl.scrollTop > 0 && listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 4
            const current = atBottom ? nodes[nodes.length - 1] : (nodes.findLast(node => node.offsetTop <= listEl.scrollTop + 8) ?? nodes[0])
            setActiveSection(current.dataset.section ?? null)
        }
        onScroll()
        listEl.addEventListener('scroll', onScroll, { passive: true })
        return () => listEl.removeEventListener('scroll', onScroll)
    }, [listEl, sectionKey])

    const shownSection = sections.some(section => section.key === activeSection) ? activeSection : (sections[0]?.key ?? null)

    const jumpToSection = (title: string) => {
        const node = listEl?.querySelector<HTMLElement>(`[data-section="${title}"]`)
        if (!listEl || !node) return
        setActiveSection(title)
        listEl.scrollTo({ top: node.offsetTop, behavior: reducedMotion ? 'auto' : 'smooth' })
    }

    const clampListHeight = (height: number) => Math.min(Math.max(height, LIST_MIN_HEIGHT), Math.min(LIST_MAX_HEIGHT, window.innerHeight - LIST_CHROME_HEIGHT))

    const onHandlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        if (!listEl) return
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { startY: event.clientY, startHeight: listEl.clientHeight, moved: false, height: null, frame: null }
    }
    // The height is written straight to the list while dragging, at most once a frame: a React render
    // per pointermove re-rendered every row and made the drag stutter. State only catches up on release.
    const onHandlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current
        if (!drag || !listEl) return
        const delta = drag.startY - event.clientY
        if (!drag.moved && Math.abs(delta) < DRAG_THRESHOLD) return
        if (!drag.moved) {
            drag.moved = true
            setDragging(true)
        }
        drag.height = clampListHeight(drag.startHeight + delta)
        drag.frame ??= requestAnimationFrame(() => {
            drag.frame = null
            if (drag.height !== null) listEl.style.maxHeight = listMaxHeightFor(drag.height, defaultListMaxHeight)
        })
    }
    const onHandlePointerUp = () => {
        const drag = dragRef.current
        if (drag?.frame != null) cancelAnimationFrame(drag.frame)
        if (drag?.height != null) setListHeight(drag.height)
        justDraggedRef.current = drag?.moved ?? false
        dragRef.current = null
        setDragging(false)
    }
    const onHandleClick = () => {
        if (justDraggedRef.current) {
            justDraggedRef.current = false
            return
        }
        setListHeight(height => (height === null ? LIST_MAX_HEIGHT : null))
    }
    const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        const current = listEl?.clientHeight ?? LIST_MIN_HEIGHT
        setListHeight(clampListHeight(current + (event.key === 'ArrowUp' ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP)))
    }

    const listMaxHeight = listMaxHeightFor(listHeight, defaultListMaxHeight)
    const morph = reducedMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 520, damping: 40 }
    const fade = reducedMotion ? { duration: 0 } : { duration: 0.18 }
    const folded = { width: pillWidth || 'auto', height: CHROME_SIZE, borderRadius: CHROME_SIZE / 2 }

    // Its own compositor layer: rasterized once, then only moved and clipped while the card morphs around it.
    const listBody = (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} className={cn('flex flex-col will-change-transform', trigger === 'pill' && 'border-b border-border')}>
            {resizable && (
                <button
                    type="button"
                    aria-label={t('inbox.resize')}
                    onPointerDown={onHandlePointerDown}
                    onPointerMove={onHandlePointerMove}
                    onPointerUp={onHandlePointerUp}
                    onPointerCancel={onHandlePointerUp}
                    onClick={onHandleClick}
                    onKeyDown={onHandleKeyDown}
                    className="absolute top-0 left-1/2 z-10 flex h-5 w-12 -translate-x-1/2 cursor-ns-resize touch-none justify-center pt-1.5 outline-none hover:[&>span]:bg-muted-foreground/50 focus-visible:[&>span]:bg-ring"
                >
                    <span className={cn('h-1 w-8 rounded-full bg-muted-foreground/25 transition-colors', dragging && 'bg-muted-foreground/50')} />
                </button>
            )}

            <div className={cn('flex items-center justify-between gap-3 px-4 pb-2', resizable ? 'pt-5' : 'pt-4')}>
                <h2 className="text-base font-semibold text-foreground">{t('inbox.title')}</h2>
                <div className="flex items-center gap-1.5">
                    {!showSettings ? null : onOpenSettings ? (
                        <Button size="sm" variant="ghost" onClick={onOpenSettings}>
                            {t('inbox.preferences')}
                        </Button>
                    ) : (
                        <TooltipDisabledReason reason={settingsDisabledReason ?? t('inbox.preferencesUnavailable')}>
                            <Button size="sm" variant="ghost" disabled>
                                {t('inbox.preferences')}
                            </Button>
                        </TooltipDisabledReason>
                    )}
                    {items.length === 0 ? (
                        <TooltipDisabledReason reason={t('inbox.nothingToMark')}>
                            <Button size="icon-sm" variant="outline" aria-label={t('inbox.markAllRead')} disabled>
                                <CheckCheckIcon className="size-3.5" />
                            </Button>
                        </TooltipDisabledReason>
                    ) : (
                        <TooltipLabeled label={t('inbox.markAllRead')}>
                            <Button size="icon-sm" variant="outline" aria-label={t('inbox.markAllRead')} onClick={onMarkAllRead}>
                                <CheckCheckIcon className="size-3.5" />
                            </Button>
                        </TooltipLabeled>
                    )}
                </div>
            </div>

            {sections.length > 1 && (
                <div className="flex flex-wrap gap-1.5 px-4 pb-2">
                    {sections.map(section => (
                        <Chip key={section.key} selected={section.key === shownSection} onClick={() => jumpToSection(section.key)}>
                            {t(`inbox.sections.${section.key}`)} <span className="ml-0.5 tabular-nums opacity-60">{section.items.reduce((sum, item) => sum + (item.count ?? 1), 0)}</span>
                        </Chip>
                    ))}
                </div>
            )}

            {running.length > 0 && <RunningLine agentIds={running} />}

            <div
                ref={setListEl}
                style={{ maxHeight: listMaxHeight, maskImage: mask, WebkitMaskImage: mask }}
                className={cn('relative overflow-y-auto overscroll-contain px-2 pb-2', !dragging && 'transition-[max-height] duration-300 ease-out motion-reduce:transition-none')}
            >
                <div>
                    {sections.length === 0 ? (
                        <EmptyState icon={InboxIcon} title={t('inbox.empty.title')} description={t('inbox.empty.description')} className="py-8" />
                    ) : (
                        sections.map(section => (
                            <section key={section.key} data-section={section.key} className="flex flex-col">
                                <h3 className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t(`inbox.sections.${section.key}`)}</h3>
                                {section.items.map(item => (
                                    <InboxRow key={item.id} item={item} onOpen={onOpenItem} onMarkRead={onMarkRead} reason={rowReason?.(item)} Menu={RowMenu} onMenuOpenChange={onRowMenuOpenChange} />
                                ))}
                            </section>
                        ))
                    )}
                </div>
            </div>
        </motion.div>
    )

    if (trigger === 'row') {
        const needs = items.filter(item => item.status !== 'done').length
        const dropped = reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }
        return (
            <div ref={rootRef} className="relative">
                <button
                    ref={pillRef}
                    type="button"
                    aria-expanded={open}
                    aria-controls={cardId}
                    aria-label={items.length > 0 ? t('inbox.pillLabel', { summary: pillSummary(items, t) }) : t('inbox.pillLabelEmpty')}
                    onClick={togglePill}
                    className={cn('flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground', cardOpen && 'bg-accent text-foreground')}
                >
                    <InboxIcon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">{t('inbox.needsYouRow')}</span>
                    {needs > 0 && (
                        <span className="relative flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white tabular-nums">
                            {pulse > 0 && !reducedMotion && (
                                <motion.span
                                    key={pulse}
                                    aria-hidden
                                    initial={{ opacity: 0.8, scale: 1 }}
                                    animate={{ opacity: 0, scale: 1.8 }}
                                    transition={{ duration: 0.8, ease: 'easeOut' }}
                                    className="pointer-events-none absolute inset-0 rounded-full border border-red-500"
                                />
                            )}
                            {needs}
                        </span>
                    )}
                </button>

                {/* Out of the list's column: the card is wider than it and a parent clips its overflow. */}
                {dropAnchor &&
                    createPortal(
                        <div ref={dropLayerRef} style={{ top: dropAnchor.top, left: dropAnchor.left }} className="fixed z-40">
                            <div aria-live="polite" className="absolute top-0 left-0 pt-1">
                                <AnimatePresence>
                                    {announcement && !cardOpen && !cardMounted && (
                                        <motion.button
                                            key={announcement.key}
                                            type="button"
                                            onClick={onAnnouncementClick}
                                            onPointerEnter={() => onAnnouncementHoldChange?.(true)}
                                            onPointerLeave={() => onAnnouncementHoldChange?.(false)}
                                            onFocus={() => onAnnouncementHoldChange?.(true)}
                                            onBlur={() => onAnnouncementHoldChange?.(false)}
                                            initial={dropped}
                                            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                                            exit={dropped}
                                            transition={morph}
                                            style={{ transformOrigin: 'top left' }}
                                            className={cn('relative block overflow-hidden rounded-xl border border-border bg-card text-left shadow-2xl transition-colors hover:bg-accent', cardClassName)}
                                        >
                                            <AnnouncementLine announcement={announcement} animated={!reducedMotion} />
                                        </motion.button>
                                    )}
                                </AnimatePresence>
                            </div>

                            <AnimatePresence onExitComplete={() => setCardMounted(false)}>
                                {cardOpen && (
                                    <motion.div
                                        id={cardId}
                                        role="region"
                                        aria-label={t('inbox.title')}
                                        initial={dropped}
                                        animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                                        exit={dropped}
                                        transition={morph}
                                        style={{ transformOrigin: 'top left' }}
                                        className="absolute top-0 left-0 mt-1 overflow-hidden rounded-[14px] border border-border bg-card shadow-2xl"
                                    >
                                        {hasDetail ? <div className={cn('relative', detailClassName)}>{detail}</div> : <div className={cn('relative flex flex-col', cardClassName, dragging && 'select-none')}>{listBody}</div>}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>,
                        document.body
                    )}
            </div>
        )
    }

    return (
        <div ref={rootRef} className="relative">
            <div aria-live="polite" className="absolute bottom-full left-0 pb-2">
                <AnimatePresence>
                    {announcement && !cardOpen && !cardMounted && (
                        <motion.button
                            key={announcement.key}
                            type="button"
                            onClick={onAnnouncementClick}
                            onPointerEnter={() => onAnnouncementHoldChange?.(true)}
                            onPointerLeave={() => onAnnouncementHoldChange?.(false)}
                            onFocus={() => onAnnouncementHoldChange?.(true)}
                            onBlur={() => onAnnouncementHoldChange?.(false)}
                            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.92 }}
                            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.7 }}
                            transition={morph}
                            style={{ transformOrigin: 'bottom left' }}
                            className="relative block w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-card text-left shadow-2xl transition-colors hover:bg-accent sm:w-80"
                        >
                            <AnnouncementLine announcement={announcement} animated={!reducedMotion} />
                        </motion.button>
                    )}
                </AnimatePresence>
            </div>
            <ChromePill
                ref={pillRef}
                start="icon"
                end="icon"
                aria-expanded={open}
                aria-controls={cardId}
                aria-label={items.length > 0 ? t('inbox.pillLabel', { summary: pillSummary(items, t) }) : t('inbox.pillLabelEmpty')}
                onClick={togglePill}
                className={cn((cardOpen || cardMounted) && 'invisible')}
            >
                {pulse > 0 && !reducedMotion && (
                    <motion.span
                        key={pulse}
                        aria-hidden
                        initial={{ opacity: 0.8, scale: 1 }}
                        animate={{ opacity: 0, scale: 1.25 }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                        className="pointer-events-none absolute inset-0 rounded-full border border-brand"
                    />
                )}
                <InboxPillContent items={items} compact />
            </ChromePill>

            <AnimatePresence onExitComplete={() => setCardMounted(false)}>
                {cardOpen && (
                    // Folded to the pill's size, the card shows only its footer, which is the pill itself.
                    <motion.div
                        id={cardId}
                        role="region"
                        aria-label={t('inbox.title')}
                        initial={folded}
                        animate={{ width: 'auto', height: 'auto', borderRadius: 14 }}
                        exit={folded}
                        transition={morph}
                        className="absolute bottom-0 left-0 z-10 flex flex-col justify-end overflow-hidden border border-border bg-card shadow-2xl"
                    >
                        <motion.span aria-hidden initial={{ opacity: 1 }} animate={{ opacity: 0 }} exit={{ opacity: 1 }} transition={fade} className="pointer-events-none absolute inset-0 rounded-[inherit]">
                            <BorderBeam pattern="arcs" tone="white" animated={false} glow angle={53} outset={1} className="opacity-30" />
                        </motion.span>
                        {hasDetail ? (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} className={cn('relative shrink-0', detailClassName)}>
                                {detail}
                            </motion.div>
                        ) : (
                        <div className={cn('relative flex shrink-0 flex-col', cardClassName, dragging && 'select-none')}>
                            {listBody}

                            <button type="button" aria-label={t('inbox.close')} onClick={closeToPill} className="flex h-[calc(var(--chrome-size)-2px)] shrink-0 items-center pr-[15px] pl-[11px] transition-colors hover:bg-accent">
                                <InboxPillContent items={items} />
                            </button>
                        </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

        </div>
    )
}

function AnnouncementLine({ announcement, animated }: { announcement: InboxAnnouncement; animated: boolean }) {
    const locale = useUiLocale()
    const t = useKitTranslations()
    const { item, bundled, loud } = announcement
    if (bundled > 1) {
        return (
            <span className="flex h-[38px] items-center gap-2.5 px-3 text-sm text-foreground">
                <span className="relative flex">
                    <BellIcon className="size-4" />
                    <span aria-hidden className="absolute -top-0.5 -right-0.5 flex size-2">
                        <span className="absolute inset-0 animate-ping rounded-full bg-red-500 motion-reduce:hidden" />
                        <span className="relative size-2 rounded-full bg-red-500 ring-2 ring-card" />
                    </span>
                </span>
                <span>{t.rich('inbox.newUpdates', { count: bundled, b: chunks => <span className="font-semibold tabular-nums">{chunks}</span> })}</span>
            </span>
        )
    }
    const meta = ATTENTION_STATUS_META[item.status] ?? ATTENTION_STATUS_META.waiting_human
    return (
        <>
            {loud && <BorderBeam pattern="arcs" tone={meta.beam} animated={animated} glow width={1} duration={4} />}
            <span className="relative flex min-w-0 items-start gap-2.5 p-2.5">
                <AttentionBuddy agentId={item.agentId} status={item.status} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">{item.title ? `${item.agentName} · ${item.title}` : item.agentName}</span>
                        {item.updatedAt && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{shortRelativeTime(item.updatedAt, locale)}</span>}
                    </span>
                    <span className="truncate text-sm font-medium text-foreground">{item.message ?? statusSentence(item, t)}</span>
                </span>
            </span>
        </>
    )
}

function RunningLine({ agentIds }: { agentIds: string[] }) {
    const t = useKitTranslations()
    const stack = [...new Set(agentIds)].slice(0, PILL_STACK_SIZE)
    return (
        <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
                {t.rich('inbox.running', { count: agentIds.length, n: chunks => <span className="tabular-nums">{chunks}</span> })}
            </span>
            <span aria-hidden className="flex shrink-0 -space-x-1.5">
                {stack.map(agentId => (
                    <AgentBuddy key={agentId} agentId={agentId} size={18} animated={false} facing="right" />
                ))}
            </span>
        </div>
    )
}

const doneCountOf = (items: InboxEntry[]) => items.reduce((sum, item) => sum + (item.status === 'done' ? (item.count ?? 1) : 0), 0)

function pillSummary(items: InboxEntry[], t: KitTranslator): string {
    const needs = items.filter(item => item.status !== 'done').length
    const done = doneCountOf(items)
    return [needs > 0 && t('inbox.needsYouCount', { count: needs }), done > 0 && t('inbox.doneCount', { count: done })].filter(Boolean).join(' · ')
}

// `compact` keeps only the bell on a phone, or on a board narrower than 56rem (the `board` container,
// shrunk by the chat column on a wide window): the full summary would crowd the bottom bar.
function InboxPillContent({ items, compact = false }: { items: InboxEntry[]; compact?: boolean }) {
    const t = useKitTranslations()
    const stack = [...new Set(items.map(item => item.agentId).filter(Boolean))].slice(0, PILL_STACK_SIZE)
    return (
        <span className="relative flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="relative flex">
                <BellIcon className="size-4" />
                {items.length > 0 && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-red-500 ring-2 ring-card" />}
            </span>
            <span className={cn('flex items-center gap-2', compact && 'pr-1 max-sm:hidden @max-4xl/board:hidden')}>
                {stack.length > 0 && (
                    <span aria-hidden className="flex -space-x-1.5">
                        {stack.map(agentId => (
                            <AgentBuddy key={agentId} agentId={agentId} size={20} animated={false} facing="right" />
                        ))}
                    </span>
                )}
                {items.length > 0 ? (
                    <PillCounts items={items} />
                ) : (
                    <span className="text-muted-foreground">{t('inbox.noUpdates')}</span>
                )}
            </span>
        </span>
    )
}

function PillCounts({ items }: { items: InboxEntry[] }) {
    const t = useKitTranslations()
    const bold = (chunks: ReactNode) => <span className="font-semibold tabular-nums">{chunks}</span>
    const needs = items.filter(item => item.status !== 'done').length
    const done = doneCountOf(items)
    return (
        <span className="flex items-center gap-1.5">
            {needs > 0 && (
                <span>{t.rich('inbox.needsYouRich', { count: needs, b: bold })}</span>
            )}
            {needs > 0 && done > 0 && <span className="text-muted-foreground">·</span>}
            {done > 0 && (
                <span className="text-emerald-500">{t.rich('inbox.doneRich', { count: done, b: bold })}</span>
            )}
        </span>
    )
}

export type RowMenuProps<T extends InboxEntry> = { item: T; onOpenChange: (open: boolean) => void }

const noop = () => {}

type InboxRowProps<T extends InboxEntry> = { item: T; onOpen: (item: T) => void; onMarkRead: (item: T) => void; reason?: ReactNode; Menu?: ComponentType<RowMenuProps<T>>; onMenuOpenChange?: (open: boolean) => void }

// `memo` drops the type parameter: the cast gives it back, so a row hands its caller the item type it was given.
export const InboxRow = memo(function InboxRow({ item, onOpen, onMarkRead, reason, Menu, onMenuOpenChange = noop }: InboxRowProps<InboxEntry>) {
    const locale = useUiLocale()
    const t = useKitTranslations()
    const meta = ATTENTION_STATUS_META[item.status] ?? ATTENTION_STATUS_META.waiting_human
    // A Radix tooltip per row made opening the card slow. The button only shows on hover or focus
    // anyway, so its tooltip is mounted the first time the row gets either.
    // Arming swaps the button for a new one: if it held the keyboard focus, the new one takes it back.
    const [tooltipArmed, setTooltipArmed] = useState(false)
    const markReadRef = useRef<HTMLButtonElement>(null)
    const refocusMarkRead = useRef(false)
    const armTooltip = () => {
        if (tooltipArmed) return
        refocusMarkRead.current = document.activeElement === markReadRef.current
        setTooltipArmed(true)
    }
    useLayoutEffect(() => {
        if (!tooltipArmed || !refocusMarkRead.current) return
        refocusMarkRead.current = false
        markReadRef.current?.focus()
    }, [tooltipArmed])

    // A row carrying its own button cannot be a <button>: nested buttons are invalid HTML.
    const activate = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen(item)
    }

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onOpen(item)}
            onKeyDown={activate}
            onPointerEnter={armTooltip}
            onFocus={armTooltip}
            className="group flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
            <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full bg-current', meta.color)} />
            <AttentionBuddy agentId={item.agentId} status={item.status} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                    <span title={item.message ?? undefined} className="truncate text-sm font-medium text-foreground">
                        {item.message ?? item.title}
                    </span>
                    {item.updatedAt && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{shortRelativeTime(item.updatedAt, locale)}</span>}
                </div>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate">{item.message ? `${item.agentName} · ${item.title}` : statusSentence(item, t)}</span>
                    {(item.count ?? 1) > 1 && <span className="shrink-0 tabular-nums">×{item.count}</span>}
                </span>
                {reason && <span className="truncate text-[11px] text-muted-foreground/80">{reason}</span>}
            </div>
            <RevealOnHover>
                {tooltipArmed ? (
                    <TooltipLabeled label={t('inbox.markRead')}>
                        <MarkReadButton ref={markReadRef} onMarkRead={() => onMarkRead(item)} />
                    </TooltipLabeled>
                ) : (
                    <MarkReadButton ref={markReadRef} onMarkRead={() => onMarkRead(item)} />
                )}
            </RevealOnHover>
            {/* React bubbles through portals: the menu's own clicks would open the row. */}
            {Menu && (
                <span className="shrink-0" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                    <Menu item={item} onOpenChange={onMenuOpenChange} />
                </span>
            )}
        </div>
    )
}) as <T extends InboxEntry>(props: InboxRowProps<T>) => ReactNode

// Spreads what the tooltip trigger slots onto it (ref, data-state, pointer handlers) and keeps its own click.
function MarkReadButton({ onMarkRead, onClick, onKeyDown, ...props }: { onMarkRead: () => void } & ComponentProps<typeof Button>) {
    const t = useKitTranslations()
    return (
        <Button
            {...props}
            size="icon-sm"
            variant="outline"
            aria-label={t('inbox.markRead')}
            onClick={event => {
                event.stopPropagation()
                onClick?.(event)
                onMarkRead()
            }}
            onKeyDown={event => {
                event.stopPropagation()
                onKeyDown?.(event)
            }}
        >
            <CheckCheckIcon className="size-3.5" />
        </Button>
    )
}

// A finger has no hover: on touch screens the action simply stays out.
function RevealOnHover({ children }: { children: ReactNode }) {
    return (
        <span className="grid shrink-0 transition-[grid-template-columns,opacity] duration-200 ease-out pointer-fine:grid-cols-[0fr] pointer-fine:opacity-0 pointer-fine:group-hover:grid-cols-[1fr] pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:grid-cols-[1fr] pointer-fine:group-focus-within:opacity-100 motion-reduce:transition-none">
            <span className="overflow-hidden">{children}</span>
        </span>
    )
}

// Where the row's card drops from, in viewport coordinates: the bottom-left corner of the row.
function useDropAnchor(anchorRef: RefObject<HTMLElement | null>, active: boolean, remeasureKey: unknown) {
    const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
    useLayoutEffect(() => {
        if (!active) return
        const measure = () => {
            const rect = anchorRef.current?.getBoundingClientRect()
            if (rect) setAnchor(current => (current?.top === rect.bottom && current.left === rect.left ? current : { top: rect.bottom, left: rect.left }))
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
    }, [anchorRef, active, remeasureKey])
    return active ? anchor : null
}
