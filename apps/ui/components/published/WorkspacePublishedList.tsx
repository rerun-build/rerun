'use client'

import { AgentBuddy } from '@rerun/ui/iso-grid'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'

import { listWorkspacePublishedAction } from '@/app/api/_actions/publish.actions'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { PANEL_CARD, PANEL_CARD_INTERACTIVE } from '@/components/ui/panel-row'
import { Skeleton } from '@/components/ui/skeleton'
import { relativeDate } from '@/lib/data/friendly-columns'
import type { PublishedAccess } from '@/lib/published/access'
import type { PublishedFile } from '@/lib/services/types'
import { GlobeIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'

import { ACCESS_ORDER, AccessBadge, useAccessCopy } from './access'
import { PublishedRowMenu } from './PublishedRowMenu'
import { PublishedThumb } from './PublishedThumb'
import { ShareDialog } from './ShareDialog'

type Filter = 'all' | PublishedAccess

const SKELETON_CARDS = 6

// Every link the coworkers of the workspace shared, filtered by who can open it. Shown in the Brain.
export function WorkspacePublishedList() {
    const t = useTranslations('published.list')
    const accessCopy = useAccessCopy()
    const [files, setFiles] = useState<PublishedFile[] | null>(null)
    const [filter, setFilter] = useState<Filter>('all')
    const [sharing, setSharing] = useState<PublishedFile | null>(null)

    useEffect(() => {
        let cancelled = false
        void listWorkspacePublishedAction().then(list => {
            if (!cancelled) setFiles(list)
        })
        return () => {
            cancelled = true
        }
    }, [])

    const replace = useCallback((file: PublishedFile) => setFiles(list => list?.map(other => (other.slug === file.slug ? file : other)) ?? null), [])
    const remove = useCallback((slug: string) => setFiles(list => list?.filter(other => other.slug !== slug) ?? null), [])

    const shown = files && filter !== 'all' ? files.filter(file => file.access === filter) : files

    return (
        <>
            <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b px-4 py-2.5">
                <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>
                    {t('filterAll', { count: files?.length ?? '' })}
                </Chip>
                {ACCESS_ORDER.map(access => (
                    <Chip key={access} selected={filter === access} onClick={() => setFilter(access)}>
                        {accessCopy.short(access)}
                    </Chip>
                ))}
            </div>
            {files?.length === 0 ? (
                <EmptyState icon={GlobeIcon} title={t('emptyTitle')} description={t('emptyDescription')} />
            ) : (
                <div className="@container min-h-0 flex-1 overflow-y-auto p-3">
                    <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2 @3xl:grid-cols-3">
                        {shown === null ? Array.from({ length: SKELETON_CARDS }, (_, index) => <GridCardSkeleton key={index} />) : shown.map(file => <GridCard key={file.slug} file={file} onShare={() => setSharing(file)} onUnpublished={remove} />)}
                    </div>
                </div>
            )}
            <ShareDialog open={sharing !== null} onOpenChange={next => !next && setSharing(null)} slug={sharing?.slug ?? null} initial={sharing} onChanged={replace} onUnpublished={remove} />
        </>
    )
}

function GridCard({ file, onShare, onUnpublished }: { file: PublishedFile; onShare: () => void; onUnpublished: (slug: string) => void }) {
    const t = useTranslations('published.list')
    const locale = useLocale()
    const coworkerName = useBoardStore(s => s.agents.find(agent => agent.id === file.agentId)?.name) ?? t('fallbackCoworker')
    const activate = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onShare()
    }
    return (
        <div role="button" tabIndex={0} onClick={onShare} onKeyDown={activate} className={cn(PANEL_CARD, PANEL_CARD_INTERACTIVE, 'flex min-w-0 cursor-pointer flex-col gap-2.5 p-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none')}>
            <PublishedThumb file={file} />
            <div className="flex min-w-0 flex-col gap-1 px-0.5">
                <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.title}</span>
                    <PublishedRowMenu file={file} onShare={onShare} onUnpublished={onUnpublished} />
                </div>
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                    <AccessBadge access={file.access} />
                    <AgentBuddy agentId={file.agentId} size={12} animated={false} facing="right" />
                    <span className="truncate">
                        {coworkerName} · {relativeDate(file.updatedAt, locale)}
                    </span>
                </div>
            </div>
        </div>
    )
}

function GridCardSkeleton() {
    return (
        <div className={cn(PANEL_CARD, 'flex min-w-0 flex-col gap-2.5 p-2.5')}>
            <Skeleton className="aspect-[16/10] w-full rounded-md" />
            <div className="flex flex-col gap-1.5 px-0.5">
                <Skeleton className="h-3.5 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
            </div>
        </div>
    )
}
