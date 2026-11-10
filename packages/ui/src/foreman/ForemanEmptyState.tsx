'use client'

import { Suggestion, Suggestions } from '../chat/Suggestion'
import { cn } from '../cn'
import { WELCOME_ORB_SIZE } from './constants'
import { Orb } from './Orb'
import { useKitTranslations } from '../locale'

export function ForemanEmptyState({ suggestions, onSuggestion, className }: { suggestions: readonly string[]; onSuggestion?: (suggestion: string) => void; className?: string }) {
    const t = useKitTranslations()
    return (
        <div className={cn('flex size-full flex-col items-center justify-center gap-4 p-8 text-center', className)}>
            {/* La même orbe que l'accueil, et pas un glyphe : c'est elle qui est le Foreman, du coin
                du board au bouton d'envoi. */}
            <Orb size={WELCOME_ORB_SIZE} />
            <div className="space-y-1">
                <h3 className="font-medium text-sm text-foreground">{t('foreman.empty.title')}</h3>
                <p className="text-muted-foreground text-sm">{t('foreman.empty.description')}</p>
            </div>
            <Suggestions className="mt-2 justify-center">
                {suggestions.map(suggestion => (
                    <Suggestion key={suggestion} suggestion={suggestion} onClick={onSuggestion} />
                ))}
            </Suggestions>
        </div>
    )
}
