'use client'

import { creditsFromMicros, formatCredits, type SpendDecision } from '@rerun/contracts'
import { Badge, PANEL_CARD } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'

import { RewindCount } from '@/components/rewind/RewindCount'
import { CoinsIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

export type SpendProgress = { spentMicros: number; running: boolean }

type SpendReceiptProps = {
    decision: SpendDecision
    // Null when the request is no longer in the transcript: the receipt then shows the decision alone.
    totalMicros: number | null
    // Read off the billed paid calls that follow the reply: the receipt fills while the coworker works.
    progress?: SpendProgress
}

const BADGE = { once: { key: 'approvedOnce', tone: 'green' }, always: { key: 'alwaysAllowed', tone: 'green' }, declined: { key: 'notNow', tone: 'neutral' } } as const

export function SpendReceipt({ decision, totalMicros, progress = { spentMicros: 0, running: false } }: SpendReceiptProps) {
    const t = useTranslations('chat.spend.receipt')
    const locale = useLocale()
    const approved = decision.decision === 'approved'
    const badge = BADGE[!approved ? 'declined' : decision.always ? 'always' : 'once']
    const { spentMicros, running } = progress

    return (
        <div className={cn(PANEL_CARD, 'ml-auto w-full max-w-[85%] space-y-2 px-3 py-2.5')}>
            <div className="flex items-start gap-2">
                <CoinsIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <p className={cn('min-w-0 flex-1 text-sm', !approved && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{decision.purpose}</p>
                <Badge size="xs" tone={badge.tone} glow={false}>
                    {t(badge.key)}
                </Badge>
            </div>
            {approved && totalMicros !== null && totalMicros > 0 && (
                <div className="flex items-center gap-2.5 pl-5.5">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className={cn('h-full rounded-full transition-[width] duration-500', running ? 'bg-orange-500' : 'bg-emerald-500')} style={{ width: `${Math.min(100, (spentMicros / totalMicros) * 100)}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                        <RewindCount value={creditsFromMicros(spentMicros)} delay={0} className="text-foreground" /> {t('ofTotal', { amount: formatCredits(totalMicros, locale), count: creditsFromMicros(totalMicros) })}
                    </span>
                </div>
            )}
        </div>
    )
}
