'use client'

import { formatNumber } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, useState, type FormEvent } from 'react'

import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PANEL_CARD } from '@/components/ui/panel-row'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'
import { CoinsIcon } from '@/lib/icons'
import { randomUuid } from '@/lib/random-uuid'
import { cn } from '@/lib/utils'

import { readCredits, wholeCredits } from './input'
import { SquareLogo } from './SquareLogo'
import { isOpenable, type ConsoleResult, type ConsoleWorkspace, type CreditTransfer } from './types'
import { useHeldDialog, type Hold } from './useHeldDialog'

type TransferDirection = 'allocate' | 'takeBack'

type TransferFormProps = {
    direction: TransferDirection
    reserveMicros: number
    workspaces: ConsoleWorkspace[]
    // Opened from a workspace: no other can be picked.
    fixedWorkspaceId?: number
    onSubmit: (transfer: CreditTransfer) => Promise<ConsoleResult>
}

export function CreditTransferDialog({ direction, onOpenChange, ...form }: Omit<TransferFormProps, 'direction'> & { direction: TransferDirection | null; onOpenChange: (open: boolean) => void }) {
    const dialog = useHeldDialog(onOpenChange)
    return (
        <Dialog open={!!direction} onOpenChange={dialog.onOpenChange}>
            <DialogContent className="sm:max-w-md sm:[@media(min-height:30rem)]:overflow-visible">{direction && <CreditTransferForm key={direction} direction={direction} {...form} hold={dialog.hold} onClose={dialog.close} />}</DialogContent>
        </Dialog>
    )
}

function CreditTransferForm({ direction, reserveMicros, workspaces, fixedWorkspaceId, onSubmit, hold, onClose }: TransferFormProps & { hold: Hold; onClose: () => void }) {
    const t = useTranslations('organization.credit.dialog')
    const tStatus = useTranslations('organization.status')
    const tCommon = useTranslations('common')
    const locale = useLocale()
    const errorText = useErrorText()
    const [workspaceId, setWorkspaceId] = useState(fixedWorkspaceId)
    const [credits, setCredits] = useState<number | null>(null)
    const [requestId, setRequestId] = useState(() => randomUuid())
    const [sending, setSending] = useState(false)
    // A double click submits twice before `sending` re-renders, and the second answer (the same
    // request, already claimed) comes back before the credit is in.
    const sendingNow = useRef(false)
    const [error, setError] = useState<string | null>(null)

    const allocating = direction === 'allocate'
    const workspace = workspaces.find(candidate => candidate.id === workspaceId)
    const available = allocating ? wholeCredits(reserveMicros) : workspace ? wholeCredits(workspace.creditMicros) : null
    const tooMuch = credits !== null && available !== null && credits > available
    const tooMuchReason = tooMuch ? t(allocating ? 'tooMuchReserve' : 'tooMuchWorkspace', { count: available }) : undefined
    const ready = !!workspace && !!credits && !tooMuch

    const edit = (change: () => void) => {
        change()
        setError(null)
        setRequestId(randomUuid())
    }

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (!ready || sendingNow.current) return
        sendingNow.current = true
        setSending(true)
        setError(null)
        const result = await hold(() => onSubmit({ workspaceId: workspace.id, credits, requestId }))
        sendingNow.current = false
        setSending(false)
        if (result.ok) onClose()
        else setError(errorText(result))
    }

    const moved = tooMuch ? 0 : (credits ?? 0)
    const change = (micros: number, sign: 1 | -1) => {
        const before = wholeCredits(micros)
        return moved ? t('change', { before: formatNumber(before, locale), after: formatNumber(before + sign * moved, locale) }) : formatNumber(before, locale)
    }

    return (
        <form onSubmit={submit} className="contents">
            <DialogHeaderBar icon={CoinsIcon} title={t(`${direction}Title`)} description={t(`${direction}Description`)} />
            <div className="space-y-4">
                {!fixedWorkspaceId && (
                    <Field label={t('workspace')}>
                        <Combobox
                            groups={[{ id: 'workspaces', options: workspaces.map(candidate => workspaceOption(candidate, direction, candidate.creditMicros > 0 ? undefined : formatNumber(0, locale), tStatus(candidate.status))) }]}
                            value={workspaceId === undefined ? undefined : String(workspaceId)}
                            onChange={next => edit(() => setWorkspaceId(Number(next)))}
                            className="min-h-10 rounded-lg"
                            placeholder={t('workspacePlaceholder')}
                            searchPlaceholder={t('workspaceSearch')}
                        />
                    </Field>
                )}
                <Field label={t('amount')} htmlFor="credit-amount" error={error ?? tooMuchReason}>
                    <Input id="credit-amount" inputMode="numeric" autoComplete="off" autoFocus={!!fixedWorkspaceId} placeholder="0" value={credits === null ? '' : formatNumber(credits, locale)} aria-invalid={tooMuch || undefined} onChange={event => edit(() => setCredits(readCredits(event.target.value)))} />
                </Field>
                <dl className={cn('space-y-2 p-3 text-sm', PANEL_CARD)}>
                    <BalanceLine label={t('reserve')} value={change(reserveMicros, allocating ? -1 : 1)} />
                    {workspace && <BalanceLine label={workspace.name} value={change(workspace.creditMicros, allocating ? 1 : -1)} />}
                </dl>
            </div>
            <DialogFooter>
                <Button type="button" variant="outline" disabled={sending} onClick={onClose}>
                    {tCommon('cancel')}
                </Button>
                <TooltipDisabledReason reason={tooMuchReason} className="max-sm:w-full">
                    <Button type="submit" loading={sending} disabled={!ready} className="max-sm:w-full">
                        {t(direction, { count: moved })}
                    </Button>
                </TooltipDisabledReason>
            </DialogFooter>
        </form>
    )
}

// Credit is given to a workspace that can spend it, and taken back from one that has some.
function workspaceOption(workspace: ConsoleWorkspace, direction: TransferDirection, emptyHint: string | undefined, statusLabel: string) {
    const refusal = direction === 'allocate' ? (isOpenable(workspace.status) ? undefined : statusLabel) : emptyHint
    return { value: String(workspace.id), keywords: [workspace.name], label: workspace.name, leading: <SquareLogo name={workspace.name} iconUrl={workspace.iconUrl} className="size-5 rounded-md text-[9px]" />, disabled: !!refusal, hint: refusal }
}

function BalanceLine({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-4">
            <dt className="min-w-0 truncate text-muted-foreground">{label}</dt>
            <dd className="shrink-0 tabular-nums">{value}</dd>
        </div>
    )
}
