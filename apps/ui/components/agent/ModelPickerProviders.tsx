'use client'

import { Command, CommandGroup, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { BrainCircuitIcon, ChevronRightIcon, Settings2Icon } from '@/lib/icons'
import type { Provider } from '@rerun/contracts'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

export type AddableProvider = Exclude<Provider, 'rerun'>
export type SubscriptionProvider = Extract<AddableProvider, 'claude' | 'codex'>

export const SUBSCRIPTION_PROVIDERS: SubscriptionProvider[] = ['claude', 'codex']

// Long enough for the pointer to cross the gap between the row and the submenu, short enough that
// moving down to another row does not leave the submenu hanging over the list.
const SUBMENU_CLOSE_DELAY_MS = 120

// The section heading already says plan or API key, so a subscription's hint names the eligible
// plans and an API key's hint names the models it unlocks.
const ADDABLE: { provider: Extract<AddableProvider, 'claude' | 'codex' | 'anthropic' | 'openai' | 'google' | 'openrouter'>; label: string; section: 'subscription' | 'api' }[] = [
    { provider: 'claude', label: 'Claude', section: 'subscription' },
    { provider: 'codex', label: 'ChatGPT', section: 'subscription' },
    { provider: 'anthropic', label: 'Anthropic', section: 'api' },
    { provider: 'openai', label: 'OpenAI', section: 'api' },
    { provider: 'google', label: 'Google', section: 'api' },
    { provider: 'openrouter', label: 'OpenRouter', section: 'api' },
]

type SubscriptionCallProps = { providers: SubscriptionProvider[]; onConnect: (provider: SubscriptionProvider) => void }

// The full pitch, for a workspace that runs on Rerun alone: a group of its own rather than a line,
// but dressed like every other group of the list.
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

// Once a subscription is plugged in the principle is understood, so the other one is a single line.
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
    claudePlanOffered: boolean
    onConnect: (provider: AddableProvider) => void
    onManage: () => void
}

// A submenu opened by hovering, like a native menu's: the row and the submenu count as one surface,
// so closing waits a beat after the pointer leaves either. Enter on the row opens it for keyboards.
export function AddProviderItem({ connectedProviders, claudePlanOffered, onConnect, onManage }: AddProviderItemProps) {
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
                                {ADDABLE.filter(p => p.section === section && (claudePlanOffered || p.provider !== 'claude')).map(p => (
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
