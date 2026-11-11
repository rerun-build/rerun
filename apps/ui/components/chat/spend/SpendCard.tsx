'use client'

import { creditsFromMicros, formatCredits, type SpendDecision, type SpendQuote, type SpendRequest } from '@rerun/contracts'
import { BorderBeam } from '@rerun/ui'
import { Button, Icon } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { CoinsIcon } from '@/lib/icons'
import { paidDataIcon } from '@/lib/paid-data/spend'
import { cn } from '@/lib/utils'

type SpendCardProps = {
    request: SpendRequest
    quote: SpendQuote
    onSubmit: (decision: Omit<SpendDecision, 'purpose'>) => void
    onAddCredits?: () => void
}

const isShort = (quote: SpendQuote) => quote.totalMicros > quote.creditLeftMicros

export function SpendCard({ request, quote, onSubmit, onAddCredits }: SpendCardProps) {
    const t = useTranslations('chat.spend')
    const tTools = useTranslations('tools')
    const locale = useLocale()
    const [submitted, setSubmitted] = useState(false)
    // Answering twice starts two runs on the same conversation: the latch has to be a ref.
    const submittedRef = useRef(false)
    const short = isShort(quote)

    const decide = (decision: Omit<SpendDecision, 'purpose'>) => {
        if (submittedRef.current) return
        submittedRef.current = true
        setSubmitted(true)
        onSubmit(decision)
    }

    return (
        <div className="@container relative space-y-3 overflow-hidden rounded-lg px-4 pt-3.5 pb-4" data-hitl="spend">
            <BorderBeam animated pattern="arcs" tone="orange" glow width={1} duration={7} />
            <div className="flex items-start gap-2.5">
                <Icon size="sm" tone="orange" icon={CoinsIcon} className="bg-orange-500/10 text-foreground" />
                <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm leading-snug font-medium">{request.purpose}</p>
                    {request.soFar && <p className="text-xs text-muted-foreground">{request.soFar}</p>}
                </div>
            </div>

            <ul className="space-y-1.5 rounded-md bg-muted/40 px-3 py-2.5">
                {quote.lines.map((line, index) => {
                    const LineIcon = paidDataIcon(line.capability)
                    return (
                        <li key={index} className="flex items-center gap-2 text-sm">
                            <LineIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{tTools(`paidData.${line.capability}`)}</span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">×{line.units}</span>
                            <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{formatCredits(line.micros, locale)}</span>
                        </li>
                    )
                })}
                <li className="flex items-baseline justify-between gap-2 border-t border-border/60 pt-2">
                    <span className="text-xs text-muted-foreground">{t('estimatedTotal')}</span>
                    <span className="text-base font-semibold tabular-nums">
                        ~{formatCredits(quote.totalMicros, locale)} <span className="text-xs font-normal text-muted-foreground">{t('creditsUnit', { count: creditsFromMicros(quote.totalMicros) })}</span>
                    </span>
                </li>
            </ul>

            {short && <MissingCredits quote={quote} />}

            {/* Narrow, the main answer takes a row of its own so three buttons never squeeze into one. */}
            <div className="grid grid-cols-2 gap-2 @sm:flex @sm:items-center">
                <Button size="sm" variant="destructive" disabled={submitted} onClick={() => decide({ decision: 'declined' })} data-hitl="decline" className={cn('@sm:mr-auto', short && 'col-span-2')}>
                    {t('notNow')}
                </Button>
                {short ? (
                    <Button size="sm" variant="default" disabled={submitted} onClick={onAddCredits} className="order-first col-span-2 @sm:order-none">
                        {t('addCredits')}
                    </Button>
                ) : (
                    <>
                        <Button size="sm" variant="outline" disabled={submitted} onClick={() => decide({ decision: 'approved', always: true })} data-hitl="always-allow">
                            {t('alwaysAllow')}
                        </Button>
                        <Button size="sm" variant="default" disabled={submitted} onClick={() => decide({ decision: 'approved' })} data-hitl="approve" className="order-first col-span-2 @sm:order-none">
                            {t('approveOnce')}
                        </Button>
                    </>
                )}
            </div>
        </div>
    )
}

// The bar is what the task needs: the credits the workspace has in solid, the gap in red stripes.
function MissingCredits({ quote }: { quote: SpendQuote }) {
    const t = useTranslations('chat.spend')
    const locale = useLocale()
    const covered = `${(quote.creditLeftMicros / quote.totalMicros) * 100}%`
    return (
        <div className="space-y-1.5">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full shrink-0 bg-foreground/70" style={{ width: covered }} />
                <div className="h-full flex-1" style={{ backgroundImage: 'repeating-linear-gradient(-45deg, var(--color-red-500) 0 2px, transparent 2px 4px)' }} />
            </div>
            <div className="flex items-baseline justify-between text-xs tabular-nums">
                <span className="text-muted-foreground">{t('creditsLeft', { amount: formatCredits(quote.creditLeftMicros, locale), count: creditsFromMicros(quote.creditLeftMicros) })}</span>
                <span className="text-red-500">{t('creditsMissing', { amount: formatCredits(quote.totalMicros - quote.creditLeftMicros, locale), count: creditsFromMicros(quote.totalMicros - quote.creditLeftMicros) })}</span>
            </div>
        </div>
    )
}
