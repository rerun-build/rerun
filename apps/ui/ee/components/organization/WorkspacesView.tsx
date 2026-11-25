'use client'

import { Badge } from '@rerun/ui/primitives'
import { creditsFromMicros, formatCredits } from '@rerun/contracts'
import { formatNumber, shortRelativeTime } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PanelList } from '@/components/ui/panel-list'
import { PANEL_CARD, PanelRow } from '@/components/ui/panel-row'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { ChevronRightIcon, LayersIcon, PlusIcon, SearchIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { ConsolePage } from './ConsolePage'
import { SquareLogo } from './SquareLogo'
import { WORKSPACE_STATUS_TONE, type ConsoleWorkspace, type ConsoleWorkspaceStatus, type WriteBlock } from './types'
import { useBlockReason } from './useBlockReason'

// Past this many the list gets a search field: a handful is read at a glance.
const SEARCH_FROM = 8

const COLUMN = { count: 'w-20 text-end', credit: 'w-24 text-end', activity: 'w-24 text-end' }

type WorkspacesViewProps = {
    workspaces: ConsoleWorkspace[] | null
    maxWorkspaces: number
    block: WriteBlock | null
    onOpen: (workspace: ConsoleWorkspace) => void
    onNew: () => void
}

export function WorkspacesView({ workspaces, maxWorkspaces, block, onOpen, onNew }: WorkspacesViewProps) {
    const t = useTranslations('organization.workspaces')
    const blockReason = useBlockReason(block)
    const [query, setQuery] = useState('')
    const count = workspaces?.length ?? 0
    const full = !!workspaces && count >= maxWorkspaces
    const newReason = blockReason ?? (full ? t('limitReached', { max: maxWorkspaces }) : undefined)

    const newButton = (
        <TooltipDisabledReason reason={newReason}>
            <Button disabled={!workspaces || !!newReason} onClick={onNew}>
                <PlusIcon />
                {t('new')}
            </Button>
        </TooltipDisabledReason>
    )

    return (
        <ConsolePage title={t('title')} meta={workspaces && <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{t('count', { count, max: maxWorkspaces })}</span>} actions={newButton}>
            {!workspaces ? <WorkspacesSkeleton /> : count === 0 ? <EmptyState icon={LayersIcon} title={t('empty.title')} description={t('empty.description')} className="py-16" /> : <WorkspaceList workspaces={workspaces} query={query} onQuery={setQuery} onOpen={onOpen} />}
        </ConsolePage>
    )
}

function WorkspaceList({ workspaces, query, onQuery, onOpen }: { workspaces: ConsoleWorkspace[]; query: string; onQuery: (query: string) => void; onOpen: (workspace: ConsoleWorkspace) => void }) {
    const t = useTranslations('organization.workspaces')
    const needle = query.trim().toLowerCase()
    const shown = needle ? workspaces.filter(workspace => workspace.name.toLowerCase().includes(needle)) : workspaces
    return (
        <div className="space-y-3">
            {workspaces.length > SEARCH_FROM && (
                <div className="relative">
                    <SearchIcon className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input type="search" aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => onQuery(event.target.value)} className="ps-9 [&::-webkit-search-cancel-button]:hidden" />
                </div>
            )}
            {shown.length === 0 ? (
                <p className="py-10 text-center text-sm break-words text-muted-foreground">{t('noMatch', { query: query.trim() })}</p>
            ) : (
                <div>
                    <div aria-hidden className="hidden items-center gap-4 px-3 pb-2 text-xs text-muted-foreground lg:flex">
                        <span className="flex-1">{t('columns.name')}</span>
                        <span className={COLUMN.count}>{t('columns.members')}</span>
                        <span className={COLUMN.count}>{t('columns.coworkers')}</span>
                        <span className={COLUMN.credit}>{t('columns.credit')}</span>
                        <span className={COLUMN.activity}>{t('columns.lastActivity')}</span>
                        <span className="w-4" />
                    </div>
                    <PanelList>
                        {shown.map(workspace => (
                            <WorkspaceRow key={workspace.id} workspace={workspace} onOpen={() => onOpen(workspace)} />
                        ))}
                    </PanelList>
                </div>
            )}
        </div>
    )
}

function WorkspaceRow({ workspace, onOpen }: { workspace: ConsoleWorkspace; onOpen: () => void }) {
    const t = useTranslations('organization.workspaces')
    const locale = useLocale()
    const activity = workspace.lastActivityAt ? shortRelativeTime(workspace.lastActivityAt, locale) : t('noActivity')
    return (
        <PanelRow
            onClick={onOpen}
            leading={<SquareLogo name={workspace.name} iconUrl={workspace.iconUrl} />}
            title={workspace.name}
            meta={<WorkspaceStatusBadge status={workspace.status} />}
            actions={
                <span className="flex items-center gap-4 text-sm text-muted-foreground tabular-nums">
                    <span className={cn('hidden lg:block', COLUMN.count)}>{formatNumber(workspace.memberCount, locale)}</span>
                    <span className={cn('hidden lg:block', COLUMN.count)}>{formatNumber(workspace.coworkerCount, locale)}</span>
                    <span className={cn('hidden lg:block', COLUMN.credit, workspace.creditMicros > 0 ? 'text-foreground' : 'text-destructive')}>{formatCredits(workspace.creditMicros, locale)}</span>
                    <span className={cn('hidden lg:block', COLUMN.activity)}>{activity}</span>
                    <ChevronRightIcon className="size-4" />
                </span>
            }
        >
            <span className="truncate text-xs text-muted-foreground lg:hidden">{t('summary', { members: workspace.memberCount, coworkers: workspace.coworkerCount, credits: creditsFromMicros(workspace.creditMicros) })}</span>
        </PanelRow>
    )
}

export function WorkspaceStatusBadge({ status }: { status: ConsoleWorkspaceStatus }) {
    const t = useTranslations('organization.status')
    return (
        <Badge size="xs" tone={WORKSPACE_STATUS_TONE[status]} glow={false} className="shrink-0 font-medium">
            {t(status)}
        </Badge>
    )
}

const NAME_WIDTHS = ['w-36', 'w-24', 'w-44', 'w-28', 'w-32']

function WorkspacesSkeleton() {
    return (
        <PanelList>
            {NAME_WIDTHS.map(width => (
                <div key={width} className={cn('flex items-center gap-3 p-3', PANEL_CARD)}>
                    <Skeleton className="size-9 shrink-0 rounded-lg" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Skeleton className={cn('h-3.5 max-w-full', width)} />
                        <Skeleton className="h-3 w-4/5 lg:hidden" />
                    </div>
                    <Skeleton className="h-4 w-14 rounded-full" />
                    <Skeleton className="hidden h-3.5 w-56 lg:block" />
                </div>
            ))}
        </PanelList>
    )
}
