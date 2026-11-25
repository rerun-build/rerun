'use client'

import { formatCredits, MICROS_PER_CREDIT } from '@rerun/contracts'
import { formatNumber, fullDateTime, shortDate } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'
import { ArrowLeftIcon, CoinsIcon, EllipsisIcon } from '@/lib/icons'
import { randomUuid } from '@/lib/random-uuid'
import { cn } from '@/lib/utils'

import { byRunway, LOW_RUNWAY_DAYS, runwayDays } from './console-alerts'
import { CreditTransferDialog } from './CreditTransferDialog'
import { readCredits, wholeCredits } from './input'
import { Heading, Page, Section } from './parts'
import { SquareLogo } from './SquareLogo'
import { isOpenable, type ConsoleRefusal, type ConsoleResult, type ConsoleWorkspace, type CreditMovement, type CreditTransfer, type WriteBlock } from './types'
import { useBlockReason } from './useBlockReason'
import { useRunwayText } from './WorkspacesView'

const FORM_ID = 'give-credit'
const FULL_RUNWAY_DAYS = 45
const WIDTH = 'max-w-5xl'
const COLUMNS = { lasts: 'w-28 max-md:hidden', has: 'w-16 text-end max-sm:hidden', give: 'w-24', then: 'w-16 text-end max-sm:hidden' }

// `requestId` is the same for every send of one amount: sent again after an answer that got lost, the
// credit moves once.
type Draft = { credits: number; requestId: string }

type CreditViewProps = {
    reserveMicros: number
    workspaces: ConsoleWorkspace[]
    movements: CreditMovement[]
    hasMore: boolean
    loadingMore: boolean
    block: WriteBlock | null
    onLoadMore: () => void
    // The ones that did not go through, by workspace.
    onGive: (transfers: CreditTransfer[]) => Promise<Map<number, ConsoleRefusal>>
    onTakeBack: (transfer: CreditTransfer) => Promise<ConsoleResult>
}

export function CreditView({ reserveMicros, workspaces, movements, hasMore, loadingMore, block, onLoadMore, onGive, onTakeBack }: CreditViewProps) {
    const t = useTranslations('organization.credit')
    const blockReason = useBlockReason(block)
    const [drafts, setDrafts] = useState<ReadonlyMap<number, Draft>>(new Map())
    const [refusals, setRefusals] = useState<ReadonlyMap<number, ConsoleRefusal>>(new Map())
    const [sending, setSending] = useState(false)
    const sendingNow = useRef(false)
    const [takingBack, setTakingBack] = useState(false)

    const rows = byRunway(workspaces)
    const given = rows.flatMap(({ id }) => {
        const draft = drafts.get(id)
        return draft && draft.credits > 0 ? [{ workspaceId: id, ...draft }] : []
    })
    const moved = given.reduce((sum, { credits }) => sum + credits, 0)
    const reserve = wholeCredits(reserveMicros)
    const tooMuch = moved > reserve
    const movedMicros = tooMuch ? 0 : moved * MICROS_PER_CREDIT
    const held = workspaces.reduce((sum, workspace) => sum + Math.max(workspace.creditMicros, 0), 0)

    const type = (id: number, credits: number | null) => {
        setDrafts(current => {
            const next = new Map(current)
            if (credits === null) next.delete(id)
            else next.set(id, { credits, requestId: randomUuid() })
            return next
        })
        setRefusals(current => new Map([...current].filter(([workspaceId]) => workspaceId !== id)))
    }

    const give = async (event: FormEvent) => {
        event.preventDefault()
        if (moved === 0 || tooMuch || blockReason || sendingNow.current) return
        sendingNow.current = true
        setSending(true)
        const refused = await onGive(given)
        sendingNow.current = false
        setSending(false)
        setRefusals(refused)
        if (refused.size > 0) toast.error(t('notGiven', { count: refused.size }))
        setDrafts(current => new Map([...current].filter(([id]) => refused.has(id))))
    }

    const takeBackReason = blockReason ?? (workspaces.some(workspace => wholeCredits(workspace.creditMicros) >= 1) ? undefined : t('nothingToTakeBack'))

    return (
        <Page width={WIDTH} footer={moved > 0 && <GiveBar moved={moved} left={reserve - moved} tooMuch={tooMuch} reason={blockReason} sending={sending} onClear={() => (setDrafts(new Map()), setRefusals(new Map()))} />}>
            <div className="space-y-10">
                <Heading
                    title={t('title')}
                    actions={
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="icon" aria-label={t('more')}>
                                    <EllipsisIcon />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                                <TooltipDisabledReason reason={takeBackReason} side="left" className="flex w-full">
                                    <DropdownMenuItem disabled={!!takeBackReason} onSelect={() => setTakingBack(true)} className="w-full">
                                        <ArrowLeftIcon />
                                        {t('takeBack')}
                                    </DropdownMenuItem>
                                </TooltipDisabledReason>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    }
                />
                <Distribution reserveMicros={reserveMicros - movedMicros} heldMicros={held + movedMicros} />
                {rows.length === 0 ? (
                    <EmptyState icon={CoinsIcon} title={t('noWorkspace')} className="py-12" />
                ) : (
                    <form id={FORM_ID} onSubmit={give}>
                        <div aria-hidden className="flex items-center gap-4 border-b border-border pb-2 text-xs text-muted-foreground sm:gap-6">
                            <span className="flex-1">{t('columns.workspace')}</span>
                            <span className={COLUMNS.lasts}>{t('columns.lasts')}</span>
                            <span className={COLUMNS.has}>{t('columns.has')}</span>
                            <span className={cn(COLUMNS.give, 'text-end')}>{t('columns.give')}</span>
                            <span className={COLUMNS.then}>{t('columns.then')}</span>
                        </div>
                        {rows.map(workspace => (
                            <GiveRow key={workspace.id} workspace={workspace} credits={drafts.get(workspace.id)?.credits ?? null} refusal={refusals.get(workspace.id)} blockReason={blockReason} disabled={sending} onType={credits => type(workspace.id, credits)} />
                        ))}
                    </form>
                )}
                <Section title={t('history')}>
                    {movements.length === 0 ? (
                        <EmptyState icon={CoinsIcon} title={t('empty.title')} description={t('empty.description')} className="py-12" />
                    ) : (
                        <>
                            {movements.map(movement => (
                                <MovementLine key={movement.id} movement={movement} />
                            ))}
                            {hasMore && (
                                <div className="flex justify-center pt-4">
                                    <Button variant="outline" size="sm" loading={loadingMore} onClick={onLoadMore}>
                                        {t('loadMore')}
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </Section>
            </div>
            <CreditTransferDialog direction={takingBack ? 'takeBack' : null} onOpenChange={setTakingBack} reserveMicros={reserveMicros} workspaces={workspaces} onSubmit={onTakeBack} />
        </Page>
    )
}

function Distribution({ reserveMicros, heldMicros }: { reserveMicros: number; heldMicros: number }) {
    const t = useTranslations('organization.credit')
    const locale = useLocale()
    return (
        <div>
            <div className="flex gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="h-2 bg-brand-chart transition-[flex-grow]" style={{ flexGrow: Math.max(reserveMicros, 0), flexBasis: 0 }} />
                <span className="h-2 bg-foreground transition-[flex-grow]" style={{ flexGrow: heldMicros, flexBasis: 0 }} />
            </div>
            <dl className="flex flex-wrap justify-between gap-x-6 gap-y-3 pt-3">
                <Total label={t('reserve')} value={formatCredits(reserveMicros, locale)} swatch="bg-brand-chart" />
                <Total label={t('withClients')} value={formatCredits(heldMicros, locale)} swatch="bg-foreground" end />
            </dl>
        </div>
    )
}

function Total({ label, value, swatch, end }: { label: string; value: string; swatch: string; end?: boolean }) {
    return (
        <div className={cn('min-w-0', end && 'text-end')}>
            <dt className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', end && 'justify-end')}>
                <span aria-hidden className={cn('size-2 rounded-[2px]', swatch)} />
                {label}
            </dt>
            <dd className="text-3xl font-medium tracking-tight tabular-nums">{value}</dd>
        </div>
    )
}

function GiveRow({ workspace, credits, refusal, blockReason, disabled, onType }: { workspace: ConsoleWorkspace; credits: number | null; refusal?: ConsoleRefusal; blockReason?: string; disabled: boolean; onType: (credits: number | null) => void }) {
    const t = useTranslations('organization')
    const locale = useLocale()
    const errorText = useErrorText()
    const runway = useRunwayText()(workspace)
    const { name, iconUrl, creditMicros, status } = workspace
    const reason = blockReason ?? (isOpenable(status) ? undefined : t(`status.${status}`))
    return (
        <div className="flex items-center gap-4 border-b border-border py-2 sm:gap-6">
            <span className="flex min-w-0 flex-1 items-center gap-3">
                <SquareLogo name={name} iconUrl={iconUrl} className="size-7 rounded-md" />
                <span className="min-w-0">
                    <span className="block truncate text-sm">{name}</span>
                    <span className="block truncate text-xs text-muted-foreground tabular-nums sm:hidden">{t('credit.hasAndLasts', { amount: formatCredits(creditMicros, locale), runway })}</span>
                    {refusal && <span className="block text-xs text-destructive">{errorText(refusal)}</span>}
                </span>
            </span>
            <span className={cn('space-y-1.5', COLUMNS.lasts)}>
                <span className={cn('block text-xs tabular-nums', creditMicros <= 0 ? 'text-destructive' : 'text-muted-foreground')}>{runway}</span>
                <RunwayBar workspace={workspace} />
            </span>
            <span className={cn('text-sm text-muted-foreground tabular-nums', COLUMNS.has)}>{formatCredits(creditMicros, locale)}</span>
            <TooltipDisabledReason reason={reason}>
                <Input
                    aria-label={t('credit.give', { name })}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="0"
                    disabled={disabled || !!reason}
                    value={credits === null ? '' : formatNumber(credits, locale)}
                    onChange={event => onType(readCredits(event.target.value))}
                    className={cn('h-9 text-end tabular-nums', COLUMNS.give)}
                />
            </TooltipDisabledReason>
            <span className={cn('text-sm tabular-nums', COLUMNS.then, credits ? 'font-medium' : 'text-muted-foreground')}>{formatCredits(creditMicros + (credits ?? 0) * MICROS_PER_CREDIT, locale)}</span>
        </div>
    )
}

function RunwayBar({ workspace }: { workspace: ConsoleWorkspace }) {
    const days = runwayDays(workspace)
    const percent = workspace.creditMicros <= 0 || days === null ? 0 : Math.min((days / FULL_RUNWAY_DAYS) * 100, 100)
    return (
        <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-muted">
            <span className={cn('block h-full rounded-full', days !== null && days < LOW_RUNWAY_DAYS ? 'bg-amber-500' : 'bg-foreground')} style={{ width: `${percent}%` }} />
        </span>
    )
}

function GiveBar({ moved, left, tooMuch, reason, sending, onClear }: { moved: number; left: number; tooMuch: boolean; reason?: string; sending: boolean; onClear: () => void }) {
    const t = useTranslations('organization.credit')
    const locale = useLocale()
    return (
        <div className="shrink-0 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
            <div className={cn('mx-auto flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8', WIDTH)}>
                <p className={cn('text-sm tabular-nums', tooMuch ? 'text-destructive' : 'text-muted-foreground')}>{tooMuch ? t('tooMuch') : t('leftInReserve', { amount: formatNumber(left, locale) })}</p>
                <div className="flex gap-2">
                    <Button type="button" variant="ghost" disabled={sending} onClick={onClear}>
                        {t('clear')}
                    </Button>
                    <TooltipDisabledReason reason={reason}>
                        <Button type="submit" form={FORM_ID} loading={sending} disabled={tooMuch || !!reason}>
                            {t('giveAll', { count: moved })}
                        </Button>
                    </TooltipDisabledReason>
                </div>
            </div>
        </div>
    )
}

function MovementLine({ movement }: { movement: CreditMovement }) {
    const t = useTranslations('organization.credit')
    const locale = useLocale()
    const gained = movement.micros > 0
    const details = [movement.reversed ? t('reversed') : movement.reversalOf ? t('reversal') : null, movement.actorName, movement.note].filter(Boolean).join(' · ')
    return (
        <div className="flex items-baseline gap-4 border-b border-border py-2.5 text-sm last:border-b-0">
            <time dateTime={movement.createdAt} title={fullDateTime(movement.createdAt, locale)} className="w-14 shrink-0 text-xs text-muted-foreground">
                {shortDate(movement.createdAt, locale)}
            </time>
            <span className="min-w-0 flex-1 truncate">
                {t(`kinds.${movement.kind}`, { workspace: movement.workspaceName ?? t('deletedWorkspace') })}
                {details && <span className="ms-2 text-xs text-muted-foreground">{details}</span>}
            </span>
            <span dir="ltr" className={cn('shrink-0 tabular-nums', movement.reversed ? 'text-muted-foreground line-through' : gained && 'text-emerald-600 dark:text-emerald-400')}>
                {gained ? '+' : '−'}
                {formatCredits(Math.abs(movement.micros), locale)}
            </span>
        </div>
    )
}

export function CreditSkeleton() {
    const t = useTranslations('organization.credit')
    return (
        <Page width={WIDTH}>
            <div className="space-y-10">
                <Heading title={t('title')} actions={<Skeleton className="size-9 rounded-lg" />} />
                <div className="space-y-3">
                    <Skeleton className="h-2 w-full rounded-full" />
                    <div className="flex justify-between">
                        <Skeleton className="h-12 w-28" />
                        <Skeleton className="h-12 w-28" />
                    </div>
                </div>
                <div>
                    {['w-40', 'w-32', 'w-48', 'w-36', 'w-28'].map(width => (
                        <div key={width} className="flex items-center gap-3 border-b border-border py-2">
                            <Skeleton className="size-7 rounded-md" />
                            <div className="flex-1">
                                <Skeleton className={cn('h-3.5 max-w-full', width)} />
                            </div>
                            <Skeleton className="h-9 w-24 rounded-lg" />
                        </div>
                    ))}
                </div>
                <Section title={t('history')}>
                    {['w-40', 'w-32', 'w-48'].map(width => (
                        <div key={width} className="flex items-center gap-4 border-b border-border py-2.5">
                            <Skeleton className="h-3 w-12" />
                            <div className="flex-1">
                                <Skeleton className={cn('h-3.5 max-w-full', width)} />
                            </div>
                            <Skeleton className="h-3.5 w-14" />
                        </div>
                    ))}
                </Section>
            </div>
        </Page>
    )
}
