'use client'

import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

// The names offered under the Box name field, as pills rather than the tiles used under the agent
// name: a Box name is one word, there is no job to describe, and a row of pills reads as "pick one
// or write your own" where a grid of cards would read as the main way in.
export function BoxNameSuggestions({ names, onPick, className }: { names: string[]; onPick: (name: string) => void; className?: string }) {
    const t = useTranslations('layout')
    if (names.length === 0) return null

    return (
        <div className={cn('space-y-2', className)}>
            <p className="text-xs font-medium text-muted-foreground">{t('boxNameSuggestions')}</p>
            <Suggestions>
                {names.map(name => (
                    <Suggestion key={name} suggestion={name} onClick={onPick} />
                ))}
            </Suggestions>
        </div>
    )
}
