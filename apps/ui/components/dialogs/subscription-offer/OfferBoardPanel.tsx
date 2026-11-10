'use client'

import { ProviderIcon } from '@/lib/engine/provider-icons'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

import { OfferBoard } from './OfferBoard'

// The board of a workspace already running on the two plans: every coworker is cabled to a Claude
// or a ChatGPT tile, and the cable lights up when it works.
export function OfferBoardPanel({ className, alive = true }: { className?: string; alive?: boolean }) {
    const t = useTranslations('dialogs.subscriptionOffer')
    return (
        <div className={cn('relative hidden overflow-hidden bg-muted/30 sm:flex sm:flex-col', className)}>
            <OfferBoard alive={alive} className="absolute inset-0" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-background/90 to-transparent p-8 pt-16">
                <p className="text-sm font-medium">{t('board.title')}</p>
                <p className="text-sm text-muted-foreground">{t('board.description')}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs whitespace-nowrap text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                        <ProviderIcon provider="claude" className="size-3.5" />
                        {t('plans.claude')}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <ProviderIcon provider="codex" className="size-3.5" />
                        {t('plans.codex')}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <ProviderIcon provider="openrouter" className="size-3.5" />
                        OpenRouter
                    </span>
                </div>
            </div>
        </div>
    )
}
