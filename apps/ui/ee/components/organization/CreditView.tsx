'use client'

import { formatCredits } from '@rerun/contracts'
import { fullDateTime, shortDate } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Icon } from '@/components/ui/icon'
import { PanelList } from '@/components/ui/panel-list'
import { PANEL_CARD, PanelRow } from '@/components/ui/panel-row'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, CoinsIcon, PencilIcon, PlusIcon, type LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { wholeCredits } from './input'
import { ConsoleGroup, ConsolePage } from './ConsolePage'
import { CreditTransferDialog, type TransferDirection } from './CreditTransferDialog'
import type { ConsoleResult, ConsoleWorkspace, CreditMovement, CreditTransfer, WriteBlock } from './types'
import { useBlockReason } from './useBlockReason'

const KIND_ICON: Record<CreditMovement['kind'], LucideIcon> = { purchase: ArrowDownIcon, adjustment: PencilIcon, allocation: ArrowRightIcon, take_back: ArrowLeftIcon }

type CreditViewProps = {
    reserveMicros: number | null
    workspaces: ConsoleWorkspace[]
    movements: CreditMovement[] | null
    hasMore: boolean
    loadingMore: boolean
    block: WriteBlock | null
    onLoadMore: () => void
    onAllocate: (transfer: CreditTransfer) => Promise<ConsoleResult>
    onTakeBack: (transfer: CreditTransfer) => Promise<ConsoleResult>
}

export function CreditView({ reserveMicros, workspaces, movements, hasMore, loadingMore, block, onLoadMore, onAllocate, onTakeBack }: CreditViewProps) {
    const t = useTranslations('organization.credit')
    const locale = useLocale()
    const blockReason = useBlockReason(block)
    const [direction, setDirection] = useState<TransferDirection | null>(null)
    const loading = reserveMicros === null

    const allocateReason = blockReason ?? (loading ? undefined : wholeCredits(reserveMicros) < 1 ? t('reserveEmpty') : workspaces.length === 0 ? t('noWorkspace') : undefined)
    const takeBackReason = blockReason ?? (loading || workspaces.some(workspace => wholeCredits(workspace.creditMicros) >= 1) ? undefined : t('nothingToTakeBack'))

    return (
        <ConsolePage title={t('title')}>
            <div className={cn('flex flex-wrap items-center justify-between gap-x-6 gap-y-4 p-4 sm:p-5', PANEL_CARD)}>
                <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">{t('reserve')}</p>
                    {loading ? <Skeleton className="h-9 w-28" /> : <p className="text-3xl font-semibold tabular-nums">{formatCredits(reserveMicros, locale)}</p>}
                    <p className="text-xs text-muted-foreground">{t('reserveHint')}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <TooltipDisabledReason reason={takeBackReason}>
                        <Button variant="outline" disabled={loading || !!takeBackReason} onClick={() => setDirection('takeBack')}>
                            {t('takeBack')}
                        </Button>
                    </TooltipDisabledReason>
                    <TooltipDisabledReason reason={allocateReason}>
                        <Button disabled={loading || !!allocateReason} onClick={() => setDirection('allocate')}>
                            <PlusIcon />
                            {t('add')}
                        </Button>
                    </TooltipDisabledReason>
                </div>
            </div>

            <ConsoleGroup title={t('history')}>
                {!movements ? (
                    <MovementsSkeleton />
                ) : movements.length === 0 ? (
                    <EmptyState icon={CoinsIcon} title={t('empty.title')} description={t('empty.description')} className="py-12" />
                ) : (
                    <>
                        <PanelList>
                            {movements.map(movement => (
                                <MovementRow key={movement.id} movement={movement} />
                            ))}
                        </PanelList>
                        {hasMore && (
                            <div className="flex justify-center pt-2">
                                <Button variant="outline" size="sm" loading={loadingMore} onClick={onLoadMore}>
                                    {t('loadMore')}
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </ConsoleGroup>

            <CreditTransferDialog direction={direction} onOpenChange={open => !open && setDirection(null)} reserveMicros={reserveMicros ?? 0} workspaces={workspaces} onSubmit={direction === 'takeBack' ? onTakeBack : onAllocate} />
        </ConsolePage>
    )
}

function MovementRow({ movement }: { movement: CreditMovement }) {
    const t = useTranslations('organization.credit')
    const locale = useLocale()
    const gained = movement.micros > 0
    const details = [movement.reversed ? t('reversed') : movement.reversalOf ? t('reversal') : null, movement.actorName, movement.note].filter(Boolean).join(' · ')
    return (
        <PanelRow
            leading={<Icon size="sm" icon={KIND_ICON[movement.kind]} />}
            title={t(`kinds.${movement.kind}`, { workspace: movement.workspaceName ?? t('deletedWorkspace') })}
            description={details || undefined}
            actions={
                <span className="flex flex-col items-end gap-0.5">
                    <span dir="ltr" className={cn('text-sm font-medium tabular-nums', movement.reversed ? 'text-muted-foreground line-through' : gained && 'text-emerald-600 dark:text-emerald-400')}>
                        {gained ? '+' : '−'}
                        {formatCredits(Math.abs(movement.micros), locale)}
                    </span>
                    <time dateTime={movement.createdAt} title={fullDateTime(movement.createdAt, locale)} className="text-xs text-muted-foreground">
                        {shortDate(movement.createdAt, locale)}
                    </time>
                </span>
            }
        />
    )
}

function MovementsSkeleton() {
    return (
        <PanelList>
            {['w-40', 'w-32', 'w-48', 'w-36'].map(width => (
                <div key={width} className={cn('flex items-center gap-3 p-3', PANEL_CARD)}>
                    <Skeleton className="size-8 shrink-0 rounded-lg" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Skeleton className={cn('h-3.5 max-w-full', width)} />
                        <Skeleton className="h-3 w-24" />
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                        <Skeleton className="h-3.5 w-14" />
                        <Skeleton className="h-3 w-12" />
                    </div>
                </div>
            ))}
        </PanelList>
    )
}
