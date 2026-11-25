'use client'

import { formatCredits, MICROS_PER_CREDIT } from '@rerun/contracts'
import { formatNumber } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'
import { randomUuid } from '@/lib/random-uuid'
import { cn } from '@/lib/utils'

import { runwayDays } from './console-alerts'
import { readCredits, wholeCredits } from './input'
import type { ConsoleResult, ConsoleWorkspace, CreditTransfer } from './types'

const EXAMPLE = 1000

type WorkspaceCreditProps = { workspace: ConsoleWorkspace; reserveMicros: number; reason?: string; onAllocate: (transfer: CreditTransfer) => Promise<ConsoleResult> }

// Adding credit is the page's main gesture: the amount is typed where the balance is read.
export function WorkspaceCredit({ workspace, reserveMicros, reason, onAllocate }: WorkspaceCreditProps) {
    const t = useTranslations('organization.credit')
    const tDetail = useTranslations('organization.detail')
    const locale = useLocale()
    const errorText = useErrorText()
    const [credits, setCredits] = useState<number | null>(null)
    const [requestId, setRequestId] = useState(() => randomUuid())
    const [sending, setSending] = useState(false)
    // A double click submits twice before `sending` re-renders.
    const sendingNow = useRef(false)
    const [error, setError] = useState<string | null>(null)

    const { creditMicros } = workspace
    const reserve = wholeCredits(reserveMicros)
    const blocked = reason ?? (reserve < 1 ? t('reserveEmpty') : undefined)
    const tooMuch = credits !== null && credits > reserve
    const amount = tooMuch ? 0 : (credits ?? 0)
    const problem = tooMuch ? t('dialog.tooMuchReserve', { count: reserve }) : error
    const empty = creditMicros <= 0
    const days = runwayDays(workspace)

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (!amount || blocked || sendingNow.current) return
        sendingNow.current = true
        setSending(true)
        setError(null)
        const result = await onAllocate({ workspaceId: workspace.id, credits: amount, requestId })
        sendingNow.current = false
        setSending(false)
        if (!result.ok) return setError(errorText(result))
        setCredits(null)
        setRequestId(randomUuid())
    }

    return (
        <div className="space-y-4">
            <div>
                <p className={cn('text-4xl font-medium tracking-tight break-words tabular-nums', empty && !amount && 'text-destructive')}>
                    {formatCredits(creditMicros, locale)}
                    {amount > 0 && <span className="text-muted-foreground"> {t('becomes', { amount: formatCredits(creditMicros + amount * MICROS_PER_CREDIT, locale) })}</span>}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{empty ? tDetail(workspace.coworkerCount > 0 ? 'paused' : 'noCredit') : days === null ? tDetail('unspent') : tDetail('daysLeft', { days })}</p>
            </div>
            <form className="flex gap-2" onSubmit={submit}>
                <Input
                    id="workspace-credit-amount"
                    aria-label={t('amountLabel')}
                    aria-invalid={tooMuch || undefined}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={formatNumber(EXAMPLE, locale)}
                    disabled={!!blocked || sending}
                    value={credits === null ? '' : formatNumber(credits, locale)}
                    onChange={event => {
                        setCredits(readCredits(event.target.value))
                        setError(null)
                        setRequestId(randomUuid())
                    }}
                    className="h-9 min-w-0 flex-1 tabular-nums"
                />
                <TooltipDisabledReason reason={blocked}>
                    <Button type="submit" size="lg" variant={empty ? 'default' : 'outline'} loading={sending} disabled={!!blocked || !amount}>
                        {t('add')}
                    </Button>
                </TooltipDisabledReason>
            </form>
            <p className={cn('text-xs tabular-nums', problem ? 'text-destructive' : 'text-muted-foreground')}>{problem ?? t('inReserve', { amount: formatCredits(Math.max(reserveMicros - amount * MICROS_PER_CREDIT, 0), locale) })}</p>
        </div>
    )
}
