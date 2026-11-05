'use client'

import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { KEY_PROVIDERS, PLAN_PROVIDERS, PROVIDER_PITCH, type AddableProvider } from '@/lib/engine/ai-sources'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { useState, type ReactNode } from 'react'

type ProviderPickerProps = {
    only: 'plan' | 'key'
    // Providers already plugged in are still offered, since two people can bring two Claude plans.
    taken: Set<string>
    onPick: (provider: AddableProvider) => void
    // The plans on offer: OpenCode only joins Claude and ChatGPT where it can run.
    planProviders?: AddableProvider[]
    children: ReactNode
}

export function ProviderPicker({ only, taken, onPick, planProviders = PLAN_PROVIDERS, children }: ProviderPickerProps) {
    const [open, setOpen] = useState(false)
    const providers = only === 'plan' ? planProviders : KEY_PROVIDERS

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
                                        <span className="truncate text-sm">{PROVIDER_PITCH[provider].title}</span>
                                        <span className="truncate text-[11px] text-muted-foreground">{PROVIDER_PITCH[provider].hint}</span>
                                    </span>
                                    {taken.has(provider) && <span className="shrink-0 text-[11px] text-muted-foreground">Added</span>}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
