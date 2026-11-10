'use client'

import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ChevronsUpDownIcon, GripVerticalIcon, XIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useMemo, useRef, useState, type ReactNode } from 'react'

// A `disabled` option stays listed and cannot be picked; `hint` says why, on its right.
export type ComboboxOption = { value: string; label: string; keywords?: string[]; leading?: ReactNode; disabled?: boolean; hint?: string }

export type ComboboxGroup = { id: string; heading?: string; options: ComboboxOption[] }

type BaseProps = {
    groups: ComboboxGroup[]
    placeholder?: string
    searchPlaceholder?: string
    emptyText?: string
    disabled?: boolean
    className?: string
}

type SingleProps = BaseProps & {
    multiple?: false
    value: string | undefined
    onChange: (value: string) => void
}

type MultiProps = BaseProps & {
    multiple: true
    value: string[]
    onChange: (values: string[]) => void
}

export function Combobox(props: SingleProps | MultiProps) {
    const t = useTranslations('ui.combobox')
    const {
        groups,
        placeholder = props.multiple ? t('placeholderMultiple') : t('placeholder'),
        searchPlaceholder = t('search'),
        emptyText = t('empty'),
        disabled,
        className,
    } = props
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)

    const onOpenChange = (next: boolean) => {
        if (next) setPortalContainer(triggerRef.current?.closest<HTMLElement>('[data-slot="dialog-content"]') ?? null)
        setOpen(next)
    }

    const selectedValues = props.multiple ? props.value : props.value ? [props.value] : []

    const visibleGroups = useMemo(() => {
        if (!props.multiple) return groups
        return groups
            .map(group => ({ ...group, options: group.options.filter(o => !selectedValues.includes(o.value)) }))
            .filter(group => group.options.length > 0)
    }, [groups, props.multiple, selectedValues.join(',')])

    const byValue = useMemo(() => {
        const map = new Map<string, ComboboxOption>()
        for (const group of groups) for (const option of group.options) map.set(option.value, option)
        return map
    }, [groups])

    const selected = useMemo(
        () => selectedValues.map(v => byValue.get(v)).filter((o): o is ComboboxOption => !!o),
        [selectedValues.join(','), byValue],
    )

    const onSelectOption = (value: string) => {
        if (props.multiple) {
            props.onChange(props.value.includes(value) ? props.value.filter(v => v !== value) : [...props.value, value])
        } else {
            props.onChange(value)
            setOpen(false)
        }
    }

    const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

    const onDragEnd = (e: DragEndEvent) => {
        if (!props.multiple) return
        const { active, over } = e
        if (!over || active.id === over.id) return
        const from = props.value.indexOf(String(active.id))
        const to = props.value.indexOf(String(over.id))
        if (from === -1 || to === -1) return
        props.onChange(arrayMove(props.value, from, to))
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <button
                    ref={triggerRef}
                    type="button"
                    disabled={disabled}
                    className={cn(
                        'flex min-h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors hover:bg-muted aria-expanded:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
                        className,
                    )}
                >
                    {selected.length === 0 ? (
                        <span className="text-muted-foreground">{placeholder}</span>
                    ) : props.multiple ? (
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                            {selected.map(option => (
                                <span
                                    key={option.value}
                                    className="flex max-w-full items-center gap-1 rounded-sm border border-border/60 bg-background/50 py-0.5 pr-1 pl-1.5 text-xs"
                                >
                                    <span className="truncate">{option.label}</span>
                                    <span
                                        role="button"
                                        aria-label={t('remove', { option: option.label })}
                                        onPointerDown={e => e.stopPropagation()}
                                        onClick={e => {
                                            e.stopPropagation()
                                            onSelectOption(option.value)
                                        }}
                                        className="rounded-xs text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                        <XIcon className="size-3" />
                                    </span>
                                </span>
                            ))}
                        </span>
                    ) : (
                        <span className="flex min-w-0 items-center gap-2">
                            {selected[0].leading}
                            <span className="truncate">{selected[0].label}</span>
                        </span>
                    )}
                    <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent container={portalContainer} align="start" className="w-(--radix-popover-trigger-width) p-0">
                <Command>
                    <CommandInput placeholder={searchPlaceholder} className="h-8 text-sm" />
                    <CommandList className="mt-1 border-t border-border/50">
                        <CommandEmpty>{emptyText}</CommandEmpty>
                        {props.multiple && selected.length > 0 && (
                            <CommandGroup heading={t('selected')} className="border-b border-border/50">
                                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                                    <SortableContext items={props.value} strategy={verticalListSortingStrategy}>
                                        {selected.map((option, index) => (
                                            <SortableSelectedItem
                                                key={option.value}
                                                option={option}
                                                order={index + 1}
                                                onSelect={() => onSelectOption(option.value)}
                                            />
                                        ))}
                                    </SortableContext>
                                </DndContext>
                            </CommandGroup>
                        )}
                        {visibleGroups.map(group => (
                            <CommandGroup key={group.id} heading={group.heading}>
                                {group.options.map(option => (
                                    <CommandItem
                                        key={option.value}
                                        value={option.value}
                                        keywords={option.keywords ?? [option.label]}
                                        onSelect={() => onSelectOption(option.value)}
                                        disabled={option.disabled}
                                        data-checked={!props.multiple && selectedValues.includes(option.value) ? 'true' : undefined}
                                        className={cn('gap-2.5 py-1.5', props.multiple && '[&>svg:last-child]:hidden')}
                                    >
                                        {props.multiple && <SelectionBox />}
                                        {option.leading}
                                        <span className="flex-1 truncate">{option.label}</span>
                                        {option.hint && <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}

function SortableSelectedItem({ option, order, onSelect }: { option: ComboboxOption; order: number; onSelect: () => void }) {
    const t = useTranslations('ui.combobox')
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.value })
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
    return (
        <div ref={setNodeRef} style={style} className={cn(isDragging && 'relative z-10')}>
            <CommandItem
                value={option.value}
                keywords={option.keywords ?? [option.label]}
                onSelect={onSelect}
                className="gap-2.5 py-1.5 [&>svg:last-child]:hidden"
            >
                <SelectionBox order={order} />
                {option.leading}
                <span className="flex-1 truncate">{option.label}</span>
                <button
                    type="button"
                    aria-label={t('reorder', { option: option.label })}
                    onClick={e => e.stopPropagation()}
                    className="cursor-grab touch-none text-muted-foreground transition-colors hover:text-foreground"
                    {...attributes}
                    {...listeners}
                >
                    <GripVerticalIcon className="size-3.5" />
                </button>
            </CommandItem>
        </div>
    )
}

function SelectionBox({ order }: { order?: number }) {
    return (
        <span
            className={cn(
                'relative flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[5px] border transition-all duration-150',
                order
                    ? 'border-border bg-primary/5 text-[11px] font-semibold tabular-nums text-foreground group-data-selected/command-item:border-foreground/25 group-data-selected/command-item:bg-background'
                    : 'border-input group-data-selected/command-item:border-foreground/25',
            )}
        >
            {order != null && (
                <>
                    <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0"
                        style={{
                            background:
                                'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.18), rgba(255,255,255,0.04) 45%, transparent 70%)',
                        }}
                    />
                    <span className="relative z-10">{order}</span>
                </>
            )}
        </span>
    )
}
