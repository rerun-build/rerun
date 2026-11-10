'use client'

import type { ComponentProps } from 'react'

import { cn } from '../cn'
import { useKitTranslations } from '../locale'
import { RefreshCwIcon } from '../icons'
import { AgentBuddy } from '../iso-grid/components/buddy/AgentBuddy'
import { Button } from '../primitives/button'
import { TooltipLabeled } from '../Tooltip'

import { AppCoin, appCoins } from './coins'
import type { AgentSuggestion, CatalogEntry, ConnectorCatalog } from './types'

// How many coworkers are on offer at once. The pool behind them is longer: reloading slides the
// window on rather than drawing again from the same three.
export const SUGGESTION_CARDS = 3

export type ForYouCardsProps = { suggestions: AgentSuggestion[]; catalog: ConnectorCatalog | null; picked: string | null; closest: string | null; onPick: (suggestion: AgentSuggestion) => void; onPreview?: (suggestion: AgentSuggestion | null) => void; onReload?: () => void; heading?: string; className?: string }

// Three coworkers already imagined, each on its own card, led by the buddy it will be on the board:
// its own colour and its own face, drawn from the suggestion's id, so the same job always sends the
// same character. The buddy stands above the card's top edge and the apps it comes with sit on its
// line, at the other end; the name and what it does for you take the rest of the card.
//
// The card under the cursor is previewed in the field. While a description of one's own is typed,
// only the card close to it stays lit and the others step back.
export function ForYouCards({ suggestions, catalog, picked, closest, onPick, onPreview, onReload, heading, className }: ForYouCardsProps) {
    const t = useKitTranslations()
    const comparing = !picked && closest !== null
    return (
        <div className={className}>
            <div className="flex h-7 items-center justify-between">
                <p className="text-sm text-muted-foreground">{comparing ? t('newAgent.forYou.closeToIdea') : (heading ?? t('newAgent.forYou.heading'))}</p>
                {onReload && (
                    <Button type="button" variant="ghost" size="xs" data-aim="reload" onClick={onReload} className="group text-muted-foreground">
                        <RefreshCwIcon className="transition-transform duration-300 group-hover:-rotate-180" />
                        {t('newAgent.forYou.otherIdeas')}
                    </Button>
                )}
            </div>
            {/* The buddies rise out of their cards, so the row needs the room above it. */}
            <div className="mt-9 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {suggestions.map(suggestion => (
                    <SuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                        apps={appCoins(suggestion.apps, catalog)}
                        lit={suggestion.id === picked || suggestion.id === closest}
                        faded={comparing && suggestion.id !== closest}
                        onClick={() => onPick(suggestion)}
                        // A tap enters too, and would leave the preview up with no cursor to take it away.
                        onPointerEnter={event => event.pointerType === 'mouse' && onPreview?.(suggestion)}
                        onPointerLeave={() => onPreview?.(null)}
                        onFocus={() => onPreview?.(suggestion)}
                        onBlur={() => onPreview?.(null)}
                    />
                ))}
            </div>
        </div>
    )
}

// The card is its own `--cut`: the ring that carves each coin out of the one under it takes the
// card's colour, lit, hovered or not, so the pile stays clean on either theme.
function SuggestionCard({ suggestion, apps, lit, faded, className, ...props }: ComponentProps<'button'> & { suggestion: AgentSuggestion; apps: (CatalogEntry | null)[]; lit: boolean; faded: boolean }) {
    return (
        <button type="button" data-pick={suggestion.id} {...props} className={cn('relative flex h-full flex-col items-start gap-2 rounded-xl bg-(--cut) px-3 pt-4 pb-3 text-left transition duration-200 hover:shadow-[0_3px_12px_rgba(0,0,0,0.08)] hover:ring-black/[0.14] hover:[--cut:var(--popover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] dark:hover:shadow-none dark:hover:[--cut:color-mix(in_oklab,var(--background),white_10%)]', lit ? 'shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-[1.5px] ring-foreground/30 [--cut:var(--popover)] dark:shadow-none dark:ring-foreground/25 dark:[--cut:color-mix(in_oklab,var(--background),white_10%)]' : 'ring-1 ring-black/[0.06] [--cut:var(--popover)] dark:ring-0 dark:[--cut:color-mix(in_oklab,var(--background),white_5.5%)]', faded && 'opacity-45', className)}>
            <AgentBuddy agentId={suggestion.id} size={64} className="absolute -top-6 left-2" />
            <AppCoins apps={apps} className="w-full" />
            <span className="text-[13px] leading-tight font-medium">{suggestion.name}</span>
            <span className="line-clamp-3 text-xs leading-snug text-muted-foreground">{suggestion.description}</span>
        </button>
    )
}

// The apps the coworker comes with. A logo alone is a guess for anyone who does not already use
// the tool, so the one under the pointer rises out of the pile and names itself in a tooltip.
function AppCoins({ apps, className }: { apps: (CatalogEntry | null)[]; className?: string }) {
    return (
        <span className={cn('flex items-center justify-end', className)}>
            {apps.map((app, index) => {
                const coin = (
                    <span key={app?.slug ?? index} data-app={app?.slug} style={{ marginLeft: index === 0 ? 0 : -6, zIndex: apps.length - index }} className="transition-transform duration-150 hover:-translate-y-0.5">
                        <AppCoin app={app} size={26} titled={false} className="ring-2 ring-(--cut)" />
                    </span>
                )
                return app ? (
                    <TooltipLabeled key={app.slug} label={app.name}>
                        {coin}
                    </TooltipLabeled>
                ) : (
                    coin
                )
            })}
        </span>
    )
}
