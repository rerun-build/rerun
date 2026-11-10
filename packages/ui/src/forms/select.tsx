'use client'

import * as React from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { cn } from '../cn'
import { Check, ChevronDown } from '../icons'
import { Field } from './field'
import { useKitTranslations } from '../locale'

interface SelectProps {
    options: readonly string[]
    value: string
    onChange: (value: string) => void
    label?: string
    optional?: boolean
    helperText?: string
    placeholder?: string
    disabled?: boolean
}

export function Select({ options, value, onChange, label, optional, helperText, placeholder, disabled }: SelectProps) {
    const t = useKitTranslations()
    const [open, setOpen] = React.useState(false)

    const handleSelect = (option: string) => {
        onChange(option === value ? '' : option)
        setOpen(false)
    }

    return (
        <Field label={label} optional={optional} helperText={helperText}>
            <PopoverPrimitive.Root modal open={open} onOpenChange={setOpen}>
                <PopoverPrimitive.Trigger asChild>
                    <button
                        type="button"
                        disabled={disabled}
                        className={cn(
                            'flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
                            !value && 'text-muted-foreground',
                        )}
                    >
                        <span className="truncate">{value || placeholder || t('forms.select')}</span>
                        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
                    </button>
                </PopoverPrimitive.Trigger>

                <PopoverPrimitive.Portal>
                    <PopoverPrimitive.Content
                        align="start"
                        sideOffset={6}
                        className="z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-lg border border-input bg-popover p-1 text-popover-foreground shadow-md outline-none"
                    >
                        <div className="max-h-64 overflow-y-auto">
                            {options.map(option => {
                                const selected = option === value
                                return (
                                    <button
                                        key={option}
                                        type="button"
                                        onClick={() => handleSelect(option)}
                                        className={cn(
                                            'flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                                            selected ? 'text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                                        )}
                                    >
                                        {option}
                                        {selected && <Check className="size-4 text-primary" />}
                                    </button>
                                )
                            })}
                        </div>
                    </PopoverPrimitive.Content>
                </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
        </Field>
    )
}
