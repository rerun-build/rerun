'use client'

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CheckIcon, ChevronsUpDownIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

function timezones(): string[] {
    const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    return supported ? supported('timeZone') : ['UTC']
}

export function TimezoneCombobox({ value, onChange, placeholder, disabled }: { value: string; onChange: (tz: string) => void; placeholder?: string; disabled?: boolean }) {
    const t = useTranslations('agent.timezoneCombobox')
    const [open, setOpen] = useState(false)
    const zones = useMemo(() => timezones(), [])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm transition-colors hover:bg-muted aria-expanded:bg-muted disabled:pointer-events-none disabled:opacity-50"
                >
                    <span className={value ? '' : 'text-muted-foreground'}>{value || placeholder || t('placeholder')}</span>
                    <ChevronsUpDownIcon className="size-3.5 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
                <Command>
                    <CommandInput placeholder={t('search')} className="h-8 text-sm" />
                    <CommandList>
                        <CommandEmpty>{t('empty')}</CommandEmpty>
                        <CommandGroup>
                            {zones.map(tz => (
                                <CommandItem
                                    key={tz}
                                    value={tz}
                                    onSelect={() => {
                                        onChange(tz)
                                        setOpen(false)
                                    }}
                                >
                                    <span className="flex-1">{tz}</span>
                                    {value === tz && <CheckIcon className="size-3.5" />}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
