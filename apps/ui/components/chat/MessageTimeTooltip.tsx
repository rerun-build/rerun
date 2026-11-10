import { useLocale } from 'next-intl'
import type { ReactElement } from 'react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { messageTime } from '@/lib/time'

// Moving down the thread crosses one bubble after another: the time only comes up on a pause.
const HOVER_DELAY_MS = 400

export function MessageTimeTooltip({ createdAt, side, children }: { createdAt?: string; side: 'left' | 'right'; children: ReactElement }) {
    const locale = useLocale()
    if (!createdAt) return children
    return (
        <TooltipProvider delayDuration={HOVER_DELAY_MS} skipDelayDuration={0}>
            <Tooltip>
                <TooltipTrigger asChild>{children}</TooltipTrigger>
                <TooltipContent side={side}>
                    <time dateTime={createdAt}>{messageTime(createdAt, locale)}</time>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
