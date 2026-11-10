'use client'

import { Button } from '@/components/ui/button'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { ArrowRightIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Stripes } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

type ComposerSubscriptionCtaProps = {
    open: boolean
    onClick: () => void
}

// Strip clipped under the composer while the chat runs on Rerun's own models: the one moment where
// it is worth saying that the Claude or ChatGPT plan the user already pays for can run this agent
// instead. It says nothing about credits, on purpose.
//
// Opening and closing goes through grid rows rather than height, so no measurement is needed.
export function ComposerSubscriptionCta({ open, onClick }: ComposerSubscriptionCtaProps) {
    const t = useTranslations('chat')
    return (
        <div className={cn('-mt-px grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
            <div className="overflow-hidden px-2">
                <div className="relative flex w-full items-center gap-2 rounded-b-lg border-x border-b border-input bg-input/30 py-1 pr-1.5 pl-3">
                    {/* Mirror of the notification nudge above the composer: stripes densest on the outer edge. */}
                    <Stripes className="rounded-b-lg" fade="top" />
                    <ProviderIcon provider="openai" className="relative size-3.5 shrink-0" />
                    <ProviderIcon provider="claude" className="relative size-3.5 shrink-0" />
                    <span className="relative min-w-0 flex-1 truncate text-xs leading-normal text-muted-foreground">{t('composer.subscriptionCta')}</span>
                    <Button size="xs" variant="outline" onClick={onClick} className="relative">
                        {t('actions.connect')}
                        <ArrowRightIcon className="size-3" />
                    </Button>
                </div>
            </div>
        </div>
    )
}
