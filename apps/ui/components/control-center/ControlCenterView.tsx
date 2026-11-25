'use client'

import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { useModKeyLabel } from '@/hooks/useModKeyLabel'
import { highlightParts, stepFilter, type SearchFilter } from '@/lib/control-center/global-search'
import { ArrowLeftIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useForemanName } from '@/hooks/useForemanName'
import { Orb } from '@rerun/ui/foreman'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { Badge, useScrollFade } from '@rerun/ui/primitives'
import { StepTransition } from '@rerun/ui/steps'
import { Command as CommandPrimitive } from 'cmdk'
import { useTranslations } from 'next-intl'
import { Fragment, useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react'

import type { ControlRow, ControlSection, SourceChip } from './types'

type ControlCenterPanelProps = {
    query: string
    onQueryChange: (query: string) => void
    placeholder: string
    // Identifies the page and how deep it sits, so a step in or out slides the right way.
    pageKey: string
    depth: number
    // The page's own trail, empty on the root.
    crumbs: string[]
    onBack: () => void
    sections: ControlSection[]
    emptyLabel: string
    mod: string
    // The global search: one chip per source under the field, Tab walking them.
    chips?: SourceChip[]
    filter?: SearchFilter
    onFilterChange?: (filter: SearchFilter) => void
    // ⌘↵ asks the assistant even when its row is not in the list (a source chip is on).
    onAsk?: () => void
}

export const HINT_KEY = 'min-w-5 px-1 py-0 text-[10px] shadow-none'

function caretAtEnd(input: EventTarget): boolean {
    return input instanceof HTMLInputElement && input.selectionStart === input.value.length && input.selectionEnd === input.value.length
}

type OrbAnchor = { vertical: 'top' | 'bottom'; horizontal: 'left' | 'right'; orbSize: number; style: CSSProperties }

// Below this the panel stays centred: a phone has no room beside the orb, and the keyboard covers the bottom corners.
const ANCHOR_QUERY = '(min-width: 640px)'

const CENTERED = 'top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0 sm:max-w-xl'
const ANCHORED = 'flex translate-x-0 translate-y-0 gap-3 rounded-none bg-transparent p-0 ring-0 sm:max-w-[28rem]'

// The panel hangs off the parked orb, whichever corner it sits in, and grows away from it.
function measureOrbAnchor(): OrbAnchor | null {
    if (!window.matchMedia(ANCHOR_QUERY).matches) return null
    const orb = document.querySelector('[data-foreman-orb]')?.getBoundingClientRect()
    if (!orb) return null
    const { clientWidth, clientHeight } = document.documentElement
    const horizontal = orb.left + orb.width / 2 > clientWidth / 2 ? 'right' : 'left'
    const vertical = orb.top + orb.height / 2 > clientHeight / 2 ? 'bottom' : 'top'
    return {
        vertical,
        horizontal,
        orbSize: orb.width,
        style: {
            top: vertical === 'top' ? orb.top : 'auto',
            bottom: vertical === 'bottom' ? clientHeight - orb.bottom : 'auto',
            left: horizontal === 'left' ? orb.left : 'auto',
            right: horizontal === 'right' ? clientWidth - orb.right : 'auto',
        },
    }
}

export function ControlCenterView({ open, onOpenChange, anchorToOrb = false, ...panel }: ControlCenterPanelProps & { open: boolean; onOpenChange: (open: boolean) => void; anchorToOrb?: boolean }) {
    const t = useTranslations('layout.controlCenter')
    const foremanName = useForemanName()
    const [anchor, setAnchor] = useState<OrbAnchor | null>(null)
    const [wasOpen, setWasOpen] = useState(false)
    if (wasOpen !== open) {
        setWasOpen(open)
        if (open) setAnchor(anchorToOrb ? measureOrbAnchor() : null)
    }

    const header = (
        <DialogHeader className="sr-only">
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description', foremanName)}</DialogDescription>
        </DialogHeader>
    )

    // ⌘K pressed with the center open closes it and puts the caret in the Foreman's pill: the dialog
    // would take it back to wherever it was before the center opened.
    const keepPillFocus = (event: Event) => {
        if (document.activeElement?.closest('[data-foreman-orb]')) event.preventDefault()
    }

    return (
        // asSheet={false}: a bottom sheet would sit under the virtual keyboard the field opens.
        <Dialog open={open} onOpenChange={onOpenChange} asSheet={false}>
            {anchor ? (
                <DialogContent
                    showCloseButton={false}
                    onCloseAutoFocus={keepPillFocus}
                    style={anchor.style}
                    className={cn(ANCHORED, anchor.vertical === 'bottom' ? 'origin-bottom flex-col' : 'origin-top flex-col-reverse', anchor.horizontal === 'right' ? 'items-end' : 'items-start')}
                >
                    {header}
                    <div className="w-full overflow-hidden rounded-xl bg-popover shadow-2xl ring-1 ring-foreground/10">
                        <ControlCenterPanel {...panel} />
                    </div>
                    {/* The overlay dims the parked orb: this one stands in for it, on the same spot. */}
                    <Orb size={anchor.orbSize} state="listening" facing={anchor.horizontal === 'left' ? 'right' : 'left'} />
                </DialogContent>
            ) : (
                <DialogContent showCloseButton={false} onCloseAutoFocus={keepPillFocus} className={CENTERED}>
                    {header}
                    <ControlCenterPanel {...panel} />
                </DialogContent>
            )}
        </Dialog>
    )
}

export function ControlCenterPanel({ query, onQueryChange, placeholder, pageKey, depth, crumbs, onBack, sections, emptyLabel, mod, chips, filter = 'all', onFilterChange, onAsk }: ControlCenterPanelProps) {
    const t = useTranslations('layout.controlCenter')
    const foremanName = useForemanName()
    const rows = sections.flatMap(section => section.rows)
    const firstRowId = rows.find(row => !row.disabledReason)?.id ?? ''
    const [selectedId, setSelectedId] = useState(firstRowId)
    const [trail, setTrail] = useState({ depth, direction: 1 })
    if (trail.depth !== depth) setTrail({ depth, direction: depth > trail.depth ? 1 : -1 })

    // A new page or a new query starts from its first row. Results that land later (conversations)
    // leave the selection where the user put it.
    const selectionScope = `${pageKey}|${query}|${filter}`
    const [selectedScope, setSelectedScope] = useState(selectionScope)
    if (selectedScope !== selectionScope) {
        setSelectedScope(selectionScope)
        setSelectedId(firstRowId)
    }

    const selectedRow = rows.find(row => row.id === selectedId)
    const ask = onAsk ?? rows.find(row => row.leading.kind === 'assistant')?.onSelect
    const [list, setList] = useState<HTMLDivElement | null>(null)
    const listFade = useScrollFade(list)

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'Tab') {
            // Focus stays in the field: the list is driven from it.
            event.preventDefault()
            if (chips) {
                // The dialog's focus trap would otherwise send Shift+Tab from the field to the last chip.
                event.stopPropagation()
                onFilterChange?.(stepFilter(filter, event.shiftKey ? -1 : 1))
            } else if (!event.shiftKey) selectedRow?.onDrill?.()
            return
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            ask?.()
            return
        }
        if (event.key === 'ArrowRight' && caretAtEnd(event.target) && selectedRow?.onDrill) {
            event.preventDefault()
            selectedRow.onDrill()
            return
        }
        if ((event.key === 'Backspace' || event.key === 'ArrowLeft') && query === '' && depth > 0) {
            event.preventDefault()
            onBack()
        }
    }

    return (
        <Command shouldFilter={false} loop value={selectedId} onValueChange={setSelectedId} onKeyDown={handleKeyDown}>
            {crumbs.length > 0 && (
                <div className="flex items-center gap-1 px-1 pt-1">
                    <Button aria-label={t('back')} variant="ghost" size="icon-sm" onClick={onBack}>
                        <ArrowLeftIcon className="size-4" />
                    </Button>
                    <span className="truncate text-xs font-medium text-muted-foreground">{crumbs.join(' / ')}</span>
                </div>
            )}
            {/* No box around the field: the panel itself is the place to write. */}
            <CommandPrimitive.Input value={query} onValueChange={onQueryChange} placeholder={placeholder} className="w-full min-w-0 bg-transparent px-3 pt-2.5 pb-3.5 text-base text-foreground outline-hidden placeholder:text-muted-foreground/70" />
            {chips && onFilterChange && <SourceChips chips={chips} filter={filter} onFilterChange={onFilterChange} />}
            <CommandList ref={setList} className={cn('-mx-1 border-t border-border/50 px-1', chips ? 'max-h-[min(26rem,calc(66dvh-8.5rem))]' : 'max-h-[min(26rem,55dvh)]')} style={{ maskImage: listFade, WebkitMaskImage: listFade }}>
                <StepTransition stepKey={pageKey} direction={trail.direction}>
                    {!chips && !sections.some(section => section.loading) && <CommandEmpty className="text-muted-foreground">{emptyLabel}</CommandEmpty>}
                    {sections.map(section =>
                        section.rows.length === 0 && !section.loading && section.emptyMessage ? (
                            <p key={section.id} className="px-3 pt-4 pb-2 text-center text-sm text-muted-foreground">
                                {section.notice ?? section.emptyMessage}
                            </p>
                        ) : (
                            <Fragment key={section.id}>
                                <CommandGroup heading={section.heading}>
                                    {section.rows.map(row => (row.source ? <HitRowItem key={row.id} row={row} query={query} /> : <ControlRowItem key={row.id} row={row} />))}
                                    {section.loading && (chips ? <HitsSkeleton /> : <ControlRowsSkeleton />)}
                                </CommandGroup>
                                {section.notice && <p className="px-3 pt-1 pb-2 text-xs text-muted-foreground">{section.notice}</p>}
                            </Fragment>
                        )
                    )}
                </StepTransition>
            </CommandList>
            <div className="-mx-1 -mb-1 flex items-center gap-4 border-t border-border/50 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <Kbd className={HINT_KEY}>↵</Kbd>
                    {t('hints.open')}
                </span>
                {chips ? (
                    <>
                        <span className="flex items-center gap-1.5 max-sm:hidden">
                            <Kbd className={HINT_KEY}>Tab</Kbd>
                            {t('hints.nextSource')}
                        </span>
                        {ask && (
                            <span className="ms-auto flex items-center gap-1.5 max-sm:hidden">
                                <Kbd className={HINT_KEY}>{mod}</Kbd>
                                <Kbd className={HINT_KEY}>↵</Kbd>
                                {t('askRerun', foremanName)}
                            </span>
                        )}
                    </>
                ) : ask ? (
                    <span className="flex items-center gap-1.5 max-sm:hidden">
                        <Kbd className={HINT_KEY}>{mod}</Kbd>
                        <Kbd className={HINT_KEY}>↵</Kbd>
                        {t('askRerun', foremanName)}
                    </span>
                ) : (
                    <span className="flex items-center gap-1.5 max-sm:hidden">
                        <Kbd className={HINT_KEY}>Tab</Kbd>
                        {t('hints.more')}
                    </span>
                )}
                {!chips && (
                    <span className="ms-auto flex items-center gap-1.5 max-sm:hidden">
                        {t.rich('hints.searchPage', {
                            keys: () => (
                                <>
                                    <Kbd className={HINT_KEY}>{mod}</Kbd>
                                    <Kbd className={HINT_KEY}>F</Kbd>
                                </>
                            ),
                        })}
                    </span>
                )}
            </div>
        </Command>
    )
}

function RowLeading({ leading }: { leading: ControlRow['leading'] }) {
    if (leading.kind === 'agent') return <AgentBuddy agentId={leading.agentId} size={20} animated={false} facing="right" />
    if (leading.kind === 'assistant') return <Orb size={18} state="listening" facing="right" />
    return <leading.icon className="size-4" />
}

export function ControlRowItem({ row }: { row: ControlRow }) {
    const mod = useModKeyLabel()
    // The assistant's row quotes what was typed: the quote gives way, not the label.
    const asking = row.leading.kind === 'assistant'

    return (
        <CommandItem value={row.id} disabled={!!row.disabledReason} onSelect={row.onSelect} className="gap-2.5 [&>svg:last-child]:hidden">
            {/* A command row sizes every svg it holds to 16px, which would crush the orb's bloom box. */}
            <span className={cn('flex size-5 shrink-0 items-center justify-center text-muted-foreground', asking && '[&_svg]:size-auto!')}>
                <RowLeading leading={row.leading} />
            </span>
            <span className="flex min-w-0 flex-col">
                <span className="flex min-w-0 items-baseline gap-2">
                    <span className={asking ? 'shrink-0' : 'truncate'}>{row.label}</span>
                    {row.detail && <span className={asking ? 'truncate text-muted-foreground' : 'shrink-0 truncate text-xs text-muted-foreground'}>{row.detail}</span>}
                </span>
                {row.disabledReason && <span className="text-xs text-muted-foreground">{row.disabledReason}</span>}
            </span>
            <span className="ms-auto flex shrink-0 items-center gap-2">
                {row.badge && (
                    <Badge size="xs" tone={row.badge.tone} glow={false} className="font-medium">
                        {row.badge.label}
                    </Badge>
                )}
                {asking && (
                    <CommandShortcut className="ms-0 flex items-center gap-1 tracking-normal max-sm:hidden!">
                        <Kbd className={HINT_KEY}>{mod}</Kbd>
                        <Kbd className={HINT_KEY}>↵</Kbd>
                    </CommandShortcut>
                )}
                {row.onDrill && (
                    <CommandShortcut className="ms-0 hidden tracking-normal group-data-[selected=true]/command-item:inline-flex max-sm:hidden!">
                        <Kbd className={HINT_KEY}>Tab</Kbd>
                    </CommandShortcut>
                )}
            </span>
        </CommandItem>
    )
}

function SourceChips({ chips, filter, onFilterChange }: { chips: SourceChip[]; filter: SearchFilter; onFilterChange: (filter: SearchFilter) => void }) {
    const [row, setRow] = useState<HTMLDivElement | null>(null)
    const fade = useScrollFade(row, { axis: 'x' })

    // Centered, clear of the fade at the edges. The row scrolls alone: `scrollIntoView` would also move
    // the dialog around it.
    useEffect(() => {
        const chip = row?.querySelector('[aria-pressed="true"]')
        if (!row || !chip) return
        const rowBox = row.getBoundingClientRect()
        const chipBox = chip.getBoundingClientRect()
        row.scrollBy({ left: chipBox.left + chipBox.width / 2 - (rowBox.left + rowBox.width / 2) })
    }, [row, filter])

    return (
        <div ref={setRow} className="-mt-1.5 flex gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none]" style={{ maskImage: fade, WebkitMaskImage: fade }}>
            {chips.map(chip => {
                const active = chip.value === filter
                return (
                    <button
                        key={chip.value}
                        type="button"
                        // Tab from the field walks the chips, and a click leaves the caret in the field.
                        tabIndex={-1}
                        onMouseDown={event => event.preventDefault()}
                        aria-pressed={active}
                        onClick={() => onFilterChange(chip.value)}
                        className={cn(
                            'flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-transparent px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                            active && 'border-border bg-muted text-foreground',
                            chip.count === 0 && !active && 'opacity-50'
                        )}
                    >
                        {chip.label}
                        {chip.count === 'pending' && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-muted-foreground/50" />}
                        {typeof chip.count === 'number' && <span className="text-muted-foreground tabular-nums">{chip.count}</span>}
                    </button>
                )
            })}
        </div>
    )
}

function Highlight({ text, query, className }: { text: string; query: string; className?: string }) {
    return (
        <span className={className}>
            {highlightParts(text, query).map((part, index) =>
                part.match ? (
                    <mark key={index} className="rounded-[3px] bg-brand/20 px-0.5 text-foreground">
                        {part.text}
                    </mark>
                ) : (
                    part.text
                )
            )}
        </span>
    )
}

function HitRowItem({ row, query }: { row: ControlRow; query: string }) {
    return (
        <CommandItem value={row.id} onSelect={row.onSelect} className="items-start gap-2.5 [&>svg:last-child]:hidden">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                <RowLeading leading={row.leading} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-baseline gap-2">
                    <Highlight text={row.label} query={query} className={cn('truncate', row.detail && 'max-w-[75%] shrink-0')} />
                    {row.detail && <span className="min-w-0 truncate text-xs text-muted-foreground">{row.detail}</span>}
                </span>
                {row.snippet && <Highlight text={row.snippet} query={query} className="truncate text-xs text-muted-foreground" />}
            </span>
        </CommandItem>
    )
}

function HitsSkeleton() {
    return (
        <div aria-hidden>
            {[52, 38, 64].map(width => (
                <div key={width} className="flex items-start gap-2.5 px-2 py-1.5">
                    <Skeleton className="size-5 rounded-md" />
                    <div className="flex flex-1 flex-col gap-1.5">
                        <Skeleton className="h-3.5" style={{ width: `${width - 20}%` }} />
                        <Skeleton className="h-3" style={{ width: `${width}%` }} />
                    </div>
                </div>
            ))}
        </div>
    )
}

function ControlRowsSkeleton() {
    return (
        <div aria-hidden>
            {[40, 56, 32].map(width => (
                <div key={width} className="flex items-center gap-2.5 px-2 py-1.5">
                    <Skeleton className="size-5 rounded-full" />
                    <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
                </div>
            ))}
        </div>
    )
}
