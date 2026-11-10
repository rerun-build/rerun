'use client'

import * as React from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { cn } from '../cn'
import { Check, ChevronDown, SearchIcon, XIcon } from '../icons'
import { Field } from './field'
import { useKitTranslations } from '../locale'

interface MultiSelectProps {
    options: readonly string[]
    value: string[]
    onChange: (value: string[]) => void
    label?: string
    optional?: boolean
    helperText?: string
    placeholder?: string
    disabled?: boolean
}

export function MultiSelect({ options, value, onChange, label, optional, helperText, placeholder, disabled }: MultiSelectProps) {
    const t = useKitTranslations()
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState('')

    const toggle = (option: string) => {
        onChange(value.includes(option) ? value.filter(item => item !== option) : [...value, option])
    }

    const remove = (option: string) => {
        onChange(value.filter(item => item !== option))
    }

    const filtered = options.filter(option => option.toLowerCase().includes(query.trim().toLowerCase()))

    return (
        <Field label={label} optional={optional} helperText={helperText}>
            <PopoverPrimitive.Root
                modal
                open={open}
                onOpenChange={next => {
                    setOpen(next)
                    if (!next) setQuery('')
                }}
            >
                <PopoverPrimitive.Trigger asChild>
                    <button
                        type="button"
                        disabled={disabled}
                        className={cn(
                            'flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 text-left outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
                        )}
                    >
                        {value.length === 0 ? (
                            <span className="px-1 text-sm text-muted-foreground">{placeholder ?? t('forms.select')}</span>
                        ) : (
                            value.map(item => (
                                <span key={item} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                                    {item}
                                    <span
                                        role="button"
                                        tabIndex={-1}
                                        aria-label={t('forms.remove', { item })}
                                        onClick={event => {
                                            event.stopPropagation()
                                            remove(item)
                                        }}
                                        className="text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                        <XIcon className="size-3" />
                                    </span>
                                </span>
                            ))
                        )}
                        <ChevronDown className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
                    </button>
                </PopoverPrimitive.Trigger>

                <PopoverPrimitive.Portal>
                    <PopoverPrimitive.Content
                        align="start"
                        sideOffset={6}
                        className="z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-lg border border-input bg-popover p-1 text-popover-foreground shadow-md outline-none"
                    >
                        <div className="flex items-center gap-2 border-b border-input px-2.5 pb-2 pt-1">
                            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
                            <input
                                autoFocus
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder={t('forms.search')}
                                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                            />
                        </div>

                        <div className="mt-1 max-h-56 overflow-y-auto py-1">
                            {filtered.length === 0 ? (
                                <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('forms.noResults')}</p>
                            ) : (
                                filtered.map(option => {
                                    const selected = value.includes(option)
                                    return (
                                        <button
                                            key={option}
                                            type="button"
                                            onClick={() => toggle(option)}
                                            className={cn(
                                                'flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                                                selected ? 'text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                                            )}
                                        >
                                            {option}
                                            {selected && <Check className="size-4 text-primary" />}
                                        </button>
                                    )
                                })
                            )}
                        </div>
                    </PopoverPrimitive.Content>
                </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
        </Field>
    )
}
