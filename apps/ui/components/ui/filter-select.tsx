'use client'

import { Command, CommandEmpty, CommandItem, CommandList } from '@/components/ui/command'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronDownIcon, SearchIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { BorderBeam } from '@rerun/ui'
import { Command as CommandPrimitive } from 'cmdk'
import { useTranslations } from 'next-intl'
import { useMemo, useRef, useState } from 'react'

export type FilterOption<T extends string = string> = { value: T; label: string; icon?: React.ReactNode }

const MAX_TRIGGER_ICONS = 4

// Past one selection the labels no longer fit: options that carry an icon collapse to a row of
// glyphs, the others fall back to the first label. Both overflow into a "+N".
function TriggerSummary<T extends string>({ selected }: { selected: FilterOption<T>[] }) {
    if (!selected.every(option => option.icon)) {
        return (
            <>
                <span className="max-w-32 truncate">{selected[0].label}</span>
                <span className="text-muted-foreground">+{selected.length - 1}</span>
            </>
        )
    }

    const shown = selected.slice(0, MAX_TRIGGER_ICONS)
    return (
        <>
            <span className="flex items-center gap-1.5">
                {shown.map(option => (
                    <span key={option.value} className="flex items-center" title={option.label}>
                        {option.icon}
                    </span>
                ))}
            </span>
            {selected.length > shown.length && <span className="text-muted-foreground">+{selected.length - shown.length}</span>}
        </>
    )
}

export function FilterSelect<T extends string>({ label, options, values, onChange, loading, className }: { label: string; options: FilterOption<T>[]; values: T[]; onChange: (values: T[]) => void; loading?: boolean; className?: string }) {
    const t = useTranslations('ui.filter')
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)

    const onOpenChange = (next: boolean) => {
        // Rendered outside the dialog, the popover loses focus containment and its first click
        // counts as an outside interaction, so it is portalled into the dialog when there is one.
        if (next) setPortalContainer(triggerRef.current?.closest<HTMLElement>('[data-slot="dialog-content"]') ?? null)
        setOpen(next)
    }

    const selected = useMemo(() => options.filter(option => values.includes(option.value)), [options, values])

    const toggle = (value: T) => onChange(values.includes(value) ? values.filter(v => v !== value) : [...values, value])

    // Options still loading: the trigger holds its place disabled, so the row does not shift once
    // they land.
    if (options.length === 0 && !loading) return null

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                {/* Fixed height: an icons-only trigger is shorter than a labelled one, and the row of pills would jump. */}
                <button ref={triggerRef} type="button" disabled={loading} className={cn('relative flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm transition-colors disabled:pointer-events-none disabled:opacity-50', selected.length > 0 ? 'border-transparent bg-foreground/5 text-foreground' : 'border-border text-muted-foreground hover:text-foreground', className)}>
                    {selected.length > 0 && <BorderBeam animated tone="white" width={1} glow />}
                    {selected.length === 0 ? (
                        label
                    ) : selected.length === 1 ? (
                        <>
                            {selected[0].icon}
                            <span className="max-w-32 truncate">{selected[0].label}</span>
                        </>
                    ) : (
                        <TriggerSummary selected={selected} />
                    )}
                    <ChevronDownIcon className={cn('size-4 opacity-50 transition-transform', open && 'rotate-180')} />
                </button>
            </PopoverTrigger>

            <PopoverContent container={portalContainer} align="start" className="w-64 p-0">
                <Command>
                    {/* The house CommandInput carries a boxed InputGroup, too heavy for a filter popover. */}
                    <div className="flex items-center gap-2 px-2.5 pb-2">
                        <SearchIcon className="size-4 shrink-0 opacity-40" />
                        <CommandPrimitive.Input placeholder={t('search', { label: label.toLowerCase() })} className="h-6 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground" />
                    </div>
                    <CommandList className="border-t border-border/50 pt-1">
                        <CommandEmpty>{t('empty')}</CommandEmpty>
                        {options.map(option => (
                            <CommandItem key={option.value} value={option.value} keywords={[option.label]} onSelect={() => toggle(option.value)} className="gap-2.5 [&>svg:last-child]:hidden">
                                <Checkbox size="sm" checked={values.includes(option.value)} className="pointer-events-none" />
                                {option.icon}
                                <span className="flex-1 truncate">{option.label}</span>
                            </CommandItem>
                        ))}
                    </CommandList>
                </Command>
                {selected.length > 0 && (
                    <button type="button" onClick={() => onChange([])} className="w-full border-t border-border/50 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground">
                        {t('clear')}
                    </button>
                )}
            </PopoverContent>
        </Popover>
    )
}
