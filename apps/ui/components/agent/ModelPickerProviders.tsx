'use client'

import { Command, CommandGroup, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { BrainCircuitIcon, ChevronRightIcon, Settings2Icon } from '@/lib/icons'
import type { Provider } from '@moldwright/contracts'
import { Badge } from '@moldwright/ui/primitives'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

export type AddableProvider = Exclude<Provider, 'rerun'>
export type SubscriptionProvider = Extract<AddableProvider, 'claude' | 'codex'>

export const SUBSCRIPTION_PROVIDERS: SubscriptionProvider[] = ['claude', 'codex']

const SUBMENU_CLOSE_DELAY_MS = 120

const ADDABLE: { provider: Extract<AddableProvider, 'claude' | 'codex' | 'anthropic' | 'openai' | 'google' | 'openrouter'>; label: string; section: 'subscription' | 'api' }[] = [
    { provider: 'claude', label: 'Claude', section: 'subscription' },
    { provider: 'codex', label: 'ChatGPT', section: 'subscription' },
    { provider: 'anthropic', label: 'Anthropic', section: 'api' },
    { provider: 'openai', label: 'OpenAI', section: 'api' },
    { provider: 'google', label: 'Google', section: 'api' },
    { provider: 'openrouter', label: 'OpenRouter', section: 'api' },
]

type SubscriptionCallProps = { providers: SubscriptionProvider[]; onConnect: (provider: SubscriptionProvider) => void }

export function SubscriptionPitch({ providers, onConnect }: SubscriptionCallProps) {
    const t = useTranslations('agent.modelPickerProviders')
    return (
        <CommandGroup heading={t('pitchHeading')}>
            {providers.map(provider => (
                <CommandItem key={provider} value={`connect subscription ${provider}`} onSelect={() => onConnect(provider)} className="gap-2.5 [&>svg:last-child]:hidden">
                    <ProviderIcon provider={provider} className="size-4" />
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm">{t(`pitch.${provider}.plan`)}</span>
                        <span className="truncate text-[11px] text-muted-foreground">{t(`pitch.${provider}.hint`)}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground group-data-selected/command-item:text-foreground">{t('connect')}</span>
                </CommandItem>
            ))}
        </CommandGroup>
    )
}

export function SubscriptionNudge({ providers, onConnect }: SubscriptionCallProps) {
    const t = useTranslations('agent.modelPickerProviders')
    return (
        <CommandGroup>
            {providers.map(provider => (
                <CommandItem key={provider} value={`connect subscription ${provider}`} onSelect={() => onConnect(provider)} className="text-xs text-muted-foreground [&>svg:last-child]:hidden">
                    <ProviderIcon provider={provider} className="size-3.5" />
                    <span className="min-w-0 flex-1 truncate">{t(`pitch.${provider}.nudge`)}</span>
                    <span className="shrink-0">{t('connect')}</span>
                </CommandItem>
            ))}
        </CommandGroup>
    )
}

type AddProviderItemProps = {
    connectedProviders: Set<Provider>
    onConnect: (provider: AddableProvider) => void
    onManage: () => void
}

export function AddProviderItem({ connectedProviders, onConnect, onManage }: AddProviderItemProps) {
    const t = useTranslations('agent.modelPickerProviders')
    const [open, setOpen] = useState(false)
    const closeTimer = useRef<number | undefined>(undefined)

    const show = () => {
        window.clearTimeout(closeTimer.current)
        setOpen(true)
    }
    const hide = () => {
        window.clearTimeout(closeTimer.current)
        closeTimer.current = window.setTimeout(() => setOpen(false), SUBMENU_CLOSE_DELAY_MS)
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverAnchor asChild>
                <CommandItem
                    value="add a provider connect subscription api key"
                    onSelect={show}
                    onPointerEnter={show}
                    onPointerLeave={hide}
                    data-open={open}
                    className="data-[open=true]:bg-muted [&>svg:last-child]:hidden"
                >
                    <BrainCircuitIcon className="size-3.5" />
                    <span className="flex-1">{t('addProvider')}</span>
                    <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                </CommandItem>
            </PopoverAnchor>
            <PopoverContent
                side="right"
                align="end"
                sideOffset={8}
                alignOffset={-4}
                className="w-64 gap-0 p-0"
                onPointerEnter={show}
                onPointerLeave={hide}
                onOpenAutoFocus={event => event.preventDefault()}
            >
                <Command>
                    <CommandList className="max-h-[min(32rem,70vh)]">
                        {(['subscription', 'api'] as const).map(section => (
                            <CommandGroup key={section} heading={t(`sections.${section}`)}>
                                {ADDABLE.filter(p => p.section === section).map(p => (
                                    <CommandItem key={p.provider} value={`${p.label} ${t(`hints.${p.provider}`)}`} onSelect={() => onConnect(p.provider)} className="gap-2.5 [&>svg:last-child]:hidden">
                                        <ProviderIcon provider={p.provider} className="size-4" />
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate text-sm">{p.label}</span>
                                            <span className="truncate text-[11px] text-muted-foreground">{t(`hints.${p.provider}`)}</span>
                                        </span>
                                        {connectedProviders.has(p.provider) && (
                                            <Badge size="xs" tone="green" fill="outline">
                                                {t('connected')}
                                            </Badge>
                                        )}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                        <CommandSeparator />
                        <CommandGroup>
                            <CommandItem value="manage connections" onSelect={onManage} className="text-muted-foreground [&>svg:last-child]:hidden">
                                <Settings2Icon className="size-3.5" />
                                {t('manage')}
                            </CommandItem>
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
