'use client'

import { creditsFromMicros, formatCredits } from '@rerun/contracts'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { CONSOLE_NEW_WORKSPACE, consoleWorkspacePath } from '@/ee/lib/organizations/console-routes'
import { LayersIcon, PlusIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { alertOf, byAttention, isQuiet, runwayDays, type WorkspaceAlert } from './console-alerts'
import { wholeCredits } from './input'
import { ClientBoard, Dot, Heading, Page, Search } from './parts'
import { SquareLogo } from './SquareLogo'
import type { ConsoleWorkspace, WriteBlock } from './types'
import { useBlockReason } from './useBlockReason'

const PAGE_SIZE = 12
const GRID = 'grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3'

type WorkspacesViewProps = {
    workspaces: ConsoleWorkspace[]
    maxWorkspaces: number
    reserveMicros: number
    block: WriteBlock | null
    resendingId: number | null
    onAddCredit: (workspace: ConsoleWorkspace) => void
    onResend: (workspace: ConsoleWorkspace) => void
}

export function WorkspacesView({ workspaces, maxWorkspaces, reserveMicros, block, resendingId, onAddCredit, onResend }: WorkspacesViewProps) {
    const t = useTranslations('organization.workspaces')
    const tCredit = useTranslations('organization.credit')
    const tFirstVisit = useTranslations('organization.firstVisit')
    const blockReason = useBlockReason(block)
    const [query, setQuery] = useState('')
    const [shown, setShown] = useState(PAGE_SIZE)
    const needle = query.trim().toLowerCase()
    const sorted = byAttention(needle ? workspaces.filter(workspace => workspace.name.toLowerCase().includes(needle)) : workspaces)

    return (
        <Page width="max-w-7xl">
            <div className="space-y-8">
                <Heading
                    title={t('title')}
                    meta={t('count', { count: workspaces.length, max: maxWorkspaces })}
                    actions={
                        <>
                            <Search label={t('search')} value={query} onChange={setQuery} className="w-44 sm:w-56" />
                            <NewWorkspaceButton reason={blockReason ?? (workspaces.length >= maxWorkspaces ? t('limitReached', { max: maxWorkspaces }) : undefined)} />
                        </>
                    }
                />
                {workspaces.length === 0 ? (
                    <EmptyState icon={LayersIcon} title={tFirstVisit('steps.workspace')} className="py-16" />
                ) : sorted.length === 0 ? (
                    <p className="py-16 text-center text-sm break-words text-muted-foreground">{t('noMatch', { query: query.trim() })}</p>
                ) : (
                    <div className={GRID}>
                        {sorted.slice(0, shown).map(workspace => (
                            <BoardCard
                                key={workspace.id}
                                workspace={workspace}
                                blockReason={blockReason}
                                creditReason={wholeCredits(reserveMicros) < 1 ? tCredit('reserveEmpty') : undefined}
                                resending={resendingId === workspace.id}
                                onAddCredit={() => onAddCredit(workspace)}
                                onResend={() => onResend(workspace)}
                            />
                        ))}
                    </div>
                )}
                {sorted.length > shown && (
                    <div className="flex justify-center">
                        <Button variant="outline" onClick={() => setShown(current => current + PAGE_SIZE)}>
                            {t('showMore')}
                        </Button>
                    </div>
                )}
            </div>
        </Page>
    )
}

function NewWorkspaceButton({ reason }: { reason?: string }) {
    const t = useTranslations('organization.workspaces')
    const label = (
        <>
            <PlusIcon />
            {t('new')}
        </>
    )
    if (!reason)
        return (
            <Link href={CONSOLE_NEW_WORKSPACE} className={buttonVariants()}>
                {label}
            </Link>
        )
    return (
        <TooltipDisabledReason reason={reason}>
            <Button disabled>{label}</Button>
        </TooltipDisabledReason>
    )
}

type BoardCardProps = { workspace: ConsoleWorkspace; blockReason?: string; creditReason?: string; resending: boolean; onAddCredit: () => void; onResend: () => void }

function BoardCard({ workspace, blockReason, creditReason, resending, onAddCredit, onResend }: BoardCardProps) {
    const { name, iconUrl, coworkers } = workspace
    const alert = alertOf(workspace)
    const href = consoleWorkspacePath(workspace.id)
    return (
        <article className="group relative min-w-0">
            <div className="relative h-48 overflow-hidden rounded-xl ring-1 ring-border transition-shadow group-hover:ring-foreground/30">
                {coworkers.length > 0 ? (
                    <ClientBoard workspace={workspace} className={cn('size-full', isQuiet(workspace) && 'opacity-40 grayscale')} />
                ) : (
                    <div className="flex size-full items-center justify-center bg-background">
                        <SquareLogo name={name} iconUrl={iconUrl} className={cn('size-16 rounded-2xl', isQuiet(workspace) && 'opacity-40 grayscale')} />
                    </div>
                )}
            </div>
            <div className="flex items-center gap-3 pt-3">
                <SquareLogo name={name} iconUrl={iconUrl} className="size-8" />
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-medium">
                        <Link href={href} className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50">
                            {name}
                        </Link>
                    </h2>
                    {alert ? <AlertLine alert={alert} /> : <StatusText workspace={workspace} />}
                </div>
                {alert && <AlertAction alert={alert} href={href} reason={alert.kind === 'invite' ? blockReason : (blockReason ?? creditReason)} resending={resending} onAddCredit={onAddCredit} onResend={onResend} />}
            </div>
        </article>
    )
}

function AlertLine({ alert }: { alert: WorkspaceAlert }) {
    const text = useAlertText()(alert)
    return (
        <span className="flex min-w-0 items-center gap-2 text-xs">
            <Dot tone={alert.severe ? 'red' : 'amber'} />
            <span className="truncate" title={text}>
                {text}
            </span>
        </span>
    )
}

function useAlertText() {
    const t = useTranslations('organization.alerts')
    return (alert: WorkspaceAlert): string => {
        if (alert.kind === 'disk') return t('disk', { percent: alert.percent })
        if (alert.kind === 'invite') return t(alert.expired ? 'inviteExpired' : 'invite', { email: alert.email })
        return alert.kind === 'lowCredit' ? t('lowCredit', { days: alert.days }) : t(alert.kind)
    }
}

function AlertAction({ alert, href, reason, resending, onAddCredit, onResend }: { alert: WorkspaceAlert; href: string; reason?: string; resending: boolean; onAddCredit: () => void; onResend: () => void }) {
    const t = useTranslations('organization.alerts.actions')
    if (alert.kind === 'disk' || alert.kind === 'machine')
        return (
            <Link href={href} className={cn('relative', buttonVariants({ variant: 'outline', size: 'sm' }))}>
                {t('seeMachine')}
            </Link>
        )
    const inviting = alert.kind === 'invite'
    return (
        <TooltipDisabledReason reason={reason} className="relative">
            <Button variant="outline" size="sm" className="relative" disabled={!!reason} loading={resending} onClick={inviting ? onResend : onAddCredit}>
                {t(inviting ? 'resend' : 'addCredit')}
            </Button>
        </TooltipDisabledReason>
    )
}

function StatusText({ workspace }: { workspace: ConsoleWorkspace }) {
    const t = useTranslations('organization')
    const locale = useLocale()
    const runway = useRunwayText()(workspace)
    return <p className="truncate text-xs text-muted-foreground tabular-nums">{isQuiet(workspace) ? t(`status.${workspace.status}`) : t('workspaces.credit', { count: creditsFromMicros(workspace.creditMicros), amount: formatCredits(workspace.creditMicros, locale), runway })}</p>
}

export function useRunwayText() {
    const t = useTranslations('organization.runway')
    return (workspace: ConsoleWorkspace): string => {
        if (workspace.creditMicros <= 0) return t('empty')
        const days = runwayDays(workspace)
        if (days === null) return t('unused')
        return days > 99 ? t('long') : t('days', { days })
    }
}

export function WorkspacesSkeleton() {
    const t = useTranslations('organization.workspaces')
    return (
        <Page width="max-w-7xl">
            <div className="space-y-8">
                <Heading
                    title={t('title')}
                    meta={<Skeleton className="h-4 w-14" />}
                    actions={
                        <>
                            <Skeleton className="h-8 w-44 rounded-lg sm:w-56" />
                            <Skeleton className="h-9 w-36 rounded-lg" />
                        </>
                    }
                />
                <div className={GRID}>
                    {['w-32', 'w-24', 'w-40', 'w-28', 'w-36', 'w-20'].map(width => (
                        <div key={width} className="min-w-0">
                            <Skeleton className="h-48 w-full rounded-xl" />
                            <div className="flex items-center gap-3 pt-3">
                                <Skeleton className="size-8 rounded-lg" />
                                <div className="flex-1 space-y-1.5">
                                    <Skeleton className={cn('h-3.5', width)} />
                                    <Skeleton className="h-3 w-28" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </Page>
    )
}
