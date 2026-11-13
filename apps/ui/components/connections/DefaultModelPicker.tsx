'use client'

import { ModelTierRow } from '@/components/agent/ModelTierRow'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PowerBars } from '@/components/ui/power-bars'
import { enabledModels, isUsable, modelName, modelDescription, type RerunCredit } from '@/lib/engine/ai-sources'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import type { BoxConnection, BoxDefault } from '@/lib/engine/types'
import { CheckIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useDialogPortalContainer } from '@rerun/ui/forms'
import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'

type DefaultModelPickerProps = {
    connections: BoxConnection[]
    current: BoxDefault
    credit: RerunCredit
    onPick: (pick: BoxDefault) => void
    children: ReactNode
}

// Grouped by source, like the chat's model picker: a model only means something next to who pays
// for it.
export function DefaultModelPicker({ connections, current, credit, onPick, children }: DefaultModelPickerProps) {
    const t = useTranslations('connections')
    const [open, setOpen] = useState(false)
    const sources = connections.filter(c => isUsable(c, credit))
    const [triggerRef, portalContainer] = useDialogPortalContainer<HTMLButtonElement>()

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger ref={triggerRef} asChild>
                {children}
            </PopoverTrigger>
            <PopoverContent container={portalContainer} align="end" className="w-72 gap-0 p-0">
                <Command>
                    <CommandList className="max-h-80">
                        {sources.map(source => (
                            <CommandGroup key={source.id} heading={source.name}>
                                {enabledModels(source).map(model => {
                                    const selected = current.connectionId === source.id && current.model === model.id
                                    const description = modelDescription(source, model.id, t)
                                    const pick = () => {
                                        setOpen(false)
                                        onPick({ connectionId: source.id, model: model.id })
                                    }
                                    if (description) {
                                        return (
                                            <CommandItem key={model.id} value={`${source.id} ${model.id}`} onSelect={pick} className="[&>svg:last-child]:hidden">
                                                <ModelTierRow label={model.label} description={description} power={model.power} />
                                                <CheckIcon className={cn('size-3.5', !selected && 'invisible')} />
                                            </CommandItem>
                                        )
                                    }
                                    return (
                                        <CommandItem key={model.id} value={`${source.id} ${model.id}`} onSelect={pick} className="gap-2 [&>svg:last-child]:hidden">
                                            <ProviderIcon provider={source.provider} className="size-3.5" />
                                            <span className="min-w-0 flex-1 truncate">{modelName(source.id, model.id)}</span>
                                            <PowerBars power={model.power} />
                                            <CheckIcon className={cn('size-3.5', !selected && 'invisible')} />
                                        </CommandItem>
                                    )
                                })}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
