'use client'

import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { useModKeyLabel } from '@/hooks/useModKeyLabel'
import { ArrowLeftIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Orb } from '@rerun/ui/foreman'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { Badge } from '@rerun/ui/primitives'
import { StepTransition } from '@rerun/ui/steps'
import { Command as CommandPrimitive } from 'cmdk'
import { useTranslations } from 'next-intl'
import { useState, type CSSProperties, type KeyboardEvent } from 'react'

import type { ControlRow, ControlSection } from './types'

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
    const [anchor, setAnchor] = useState<OrbAnchor | null>(null)
    const [wasOpen, setWasOpen] = useState(false)
    if (wasOpen !== open) {
        setWasOpen(open)
        if (open) setAnchor(anchorToOrb ? measureOrbAnchor() : null)
    }

    const header = (
        <DialogHeader className="sr-only">
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
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

export function ControlCenterPanel({ query, onQueryChange, placeholder, pageKey, depth, crumbs, onBack, sections, emptyLabel, mod }: ControlCenterPanelProps) {
    const t = useTranslations('layout.controlCenter')
    const rows = sections.flatMap(section => section.rows)
    const firstRowId = rows.find(row => !row.disabledReason)?.id ?? ''
    const [selectedId, setSelectedId] = useState(firstRowId)
    const [trail, setTrail] = useState({ depth, direction: 1 })
    if (trail.depth !== depth) setTrail({ depth, direction: depth > trail.depth ? 1 : -1 })

    // A new page or a new query starts from its first row. Results that land later (conversations)
    // leave the selection where the user put it.
    const selectionScope = `${pageKey}|${query}`
    const [selectedScope, setSelectedScope] = useState(selectionScope)
    if (selectedScope !== selectionScope) {
        setSelectedScope(selectionScope)
        setSelectedId(firstRowId)
    }

    const selectedRow = rows.find(row => row.id === selectedId)
    const askRow = rows.find(row => row.leading.kind === 'assistant')

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'Tab') {
            // Focus stays in the field: the list is driven from it.
            event.preventDefault()
            if (!event.shiftKey) selectedRow?.onDrill?.()
            return
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            askRow?.onSelect()
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
            <CommandList className="-mx-1 max-h-[min(26rem,55dvh)] border-t border-border/50 px-1">
                <StepTransition stepKey={pageKey} direction={trail.direction}>
                    {!sections.some(section => section.loading) && <CommandEmpty className="text-muted-foreground">{emptyLabel}</CommandEmpty>}
                    {sections.map(section => (
                        <CommandGroup key={section.id} heading={section.heading}>
                            {section.rows.map(row => (
                                <ControlRowItem key={row.id} row={row} />
                            ))}
                            {section.loading && <ControlRowsSkeleton />}
                        </CommandGroup>
                    ))}
                </StepTransition>
            </CommandList>
            <div className="-mx-1 -mb-1 flex items-center gap-4 border-t border-border/50 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <Kbd className={HINT_KEY}>↵</Kbd>
                    {t('hints.open')}
                </span>
                {askRow ? (
                    <span className="flex items-center gap-1.5 max-sm:hidden">
                        <Kbd className={HINT_KEY}>{mod}</Kbd>
                        <Kbd className={HINT_KEY}>↵</Kbd>
                        {t('askRerun')}
                    </span>
                ) : (
                    <span className="flex items-center gap-1.5 max-sm:hidden">
                        <Kbd className={HINT_KEY}>Tab</Kbd>
                        {t('hints.more')}
                    </span>
                )}
                <span className="ml-auto flex items-center gap-1.5 max-sm:hidden">
                    {t.rich('hints.searchPage', {
                        keys: () => (
                            <>
                                <Kbd className={HINT_KEY}>{mod}</Kbd>
                                <Kbd className={HINT_KEY}>F</Kbd>
                            </>
                        ),
                    })}
                </span>
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
            <span className="ml-auto flex shrink-0 items-center gap-2">
                {row.badge && (
                    <Badge size="xs" tone={row.badge.tone} glow={false} className="font-medium">
                        {row.badge.label}
                    </Badge>
                )}
                {asking && (
                    <CommandShortcut className="ml-0 flex items-center gap-1 tracking-normal max-sm:hidden!">
                        <Kbd className={HINT_KEY}>{mod}</Kbd>
                        <Kbd className={HINT_KEY}>↵</Kbd>
                    </CommandShortcut>
                )}
                {row.onDrill && (
                    <CommandShortcut className="ml-0 hidden tracking-normal group-data-[selected=true]/command-item:inline-flex max-sm:hidden!">
                        <Kbd className={HINT_KEY}>Tab</Kbd>
                    </CommandShortcut>
                )}
            </span>
        </CommandItem>
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
