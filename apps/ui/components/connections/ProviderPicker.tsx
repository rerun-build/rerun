'use client'

import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { providerPitch, type AddableProvider } from '@/lib/engine/ai-sources'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'

type ProviderPickerProps = {
    // Providers already plugged in are still offered, since two people can bring two Claude plans.
    taken: Set<string>
    onPick: (provider: AddableProvider) => void
    // What this machine can run: OpenCode only joins the plans, and a custom endpoint the API keys,
    // where the engine knows them.
    providers: AddableProvider[]
    children: ReactNode
}

export function ProviderPicker({ taken, onPick, providers, children }: ProviderPickerProps) {
    const t = useTranslations('connections.providerPicker')
    const tConnections = useTranslations('connections')
    const [open, setOpen] = useState(false)

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent align="end" className="w-64 gap-0 p-0">
                <Command>
                    <CommandList>
                        <CommandGroup>
                            {providers.map(provider => (
                                <CommandItem
                                    key={provider}
                                    value={provider}
                                    onSelect={() => {
                                        setOpen(false)
                                        onPick(provider)
                                    }}
                                    className="gap-2.5 [&>svg:last-child]:hidden"
                                >
                                    <ProviderIcon provider={provider} className="size-4" />
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-sm">{providerPitch(provider, tConnections).title}</span>
                                        <span className="truncate text-[11px] text-muted-foreground">{providerPitch(provider, tConnections).hint}</span>
                                    </span>
                                    {taken.has(provider) && <span className="shrink-0 text-[11px] text-muted-foreground">{t('added')}</span>}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
