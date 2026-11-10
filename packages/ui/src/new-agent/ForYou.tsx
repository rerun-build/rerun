'use client'

import type { ComponentProps } from 'react'

import type { ConnectorCatalog } from './types'
import type { AgentSuggestion } from './types'
import type { CatalogEntry } from './types'
import { cn } from '../cn'
import { useKitTranslations } from '../locale'

import { appCoins, CoinStack } from './coins'

// Low chips led by their round logos, each as wide as its own content, wrapping under the field.
// The one under the cursor is previewed in the field. A
// picked chip stays lit; while a description of one's own is typed, only the suggestion close to it
// stays lit and the others step back.
export function ForYou({ suggestions, catalog, picked, closest, onPick, onPreview, heading, className }: { suggestions: AgentSuggestion[]; catalog: ConnectorCatalog | null; picked: string | null; closest: string | null; onPick: (suggestion: AgentSuggestion) => void; onPreview?: (suggestion: AgentSuggestion | null) => void; heading?: string; className?: string }) {
    const t = useKitTranslations()
    const comparing = !picked && closest !== null
    return (
        <div className={className}>
            <p className="flex h-7 items-center text-sm text-muted-foreground">{comparing ? t('newAgent.forYou.closeToIdea') : (heading ?? t('newAgent.forYou.heading'))}</p>
            <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.map((suggestion, index) => {
                    const lit = picked ? suggestion.id === picked : comparing ? suggestion.id === closest : index === 0
                    return (
                        <SuggestionChip
                            key={suggestion.id}
                            suggestion={suggestion}
                            apps={appCoins(suggestion.apps, catalog)}
                            lit={lit}
                            faded={comparing && suggestion.id !== closest}
                            onClick={() => onPick(suggestion)}
                            // A tap enters too, and would leave the preview up with no cursor to take it away.
                            onPointerEnter={event => event.pointerType === 'mouse' && onPreview?.(suggestion)}
                            onPointerLeave={() => onPreview?.(null)}
                            onFocus={() => onPreview?.(suggestion)}
                            onBlur={() => onPreview?.(null)}
                        />
                    )
                })}
            </div>
        </div>
    )
}

// The chip is its own `--cut`: the ring that carves each coin out of the one under it takes the
// chip's colour, lit, hovered or not, so the pile stays clean on either theme.
function SuggestionChip({ suggestion, apps, lit, faded, className, ...props }: ComponentProps<'button'> & { suggestion: AgentSuggestion; apps: (CatalogEntry | null)[]; lit: boolean; faded: boolean }) {
    return (
        <button type="button" data-pick={suggestion.id} {...props} className={cn('inline-flex h-8 items-center gap-2 rounded-lg bg-(--cut) pr-3 pl-1.5 text-[13px] transition duration-200 hover:text-foreground hover:opacity-100 hover:shadow-[0_2px_6px_rgba(0,0,0,0.1)] hover:ring-black/20 hover:[--cut:var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 active:scale-[0.98] dark:hover:shadow-none dark:hover:[--cut:color-mix(in_oklab,var(--background),white_16%)]', lit ? 'text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.11] [--cut:var(--popover)] dark:shadow-none dark:ring-0 dark:[--cut:color-mix(in_oklab,var(--background),white_10%)]' : 'text-foreground/80 ring-1 ring-black/[0.06] [--cut:var(--popover)] dark:ring-0 dark:[--cut:color-mix(in_oklab,var(--background),white_5.5%)]', faded && 'opacity-20', className)}>
            <CoinStack apps={apps} size={20} overlap={4} />
            {suggestion.name}
        </button>
    )
}
