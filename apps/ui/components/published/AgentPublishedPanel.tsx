'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

import { listPublishedAction } from '@/app/api/_actions/publish.actions'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PANEL_CARD, PanelRow } from '@/components/ui/panel-row'
import { Skeleton } from '@/components/ui/skeleton'
import { relativeDate } from '@/lib/data/friendly-columns'
import { publishedHostOf } from '@/lib/published/links'
import type { PublishedFile } from '@/lib/services/types'
import { CopyIcon, GlobeIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { AccessBadge } from './access'
import { PublishedRowMenu } from './PublishedRowMenu'
import { PublishedThumb } from './PublishedThumb'
import { ShareDialog } from './ShareDialog'

const SKELETON_ROWS = 3

// What one coworker published, a card per link. A card opens the share dialog.
export function AgentPublishedPanel({ agentId, agentName }: { agentId: string; agentName: string }) {
    const t = useTranslations('published.panel')
    const locale = useLocale()
    const [files, setFiles] = useState<PublishedFile[] | null>(null)
    const [sharing, setSharing] = useState<PublishedFile | null>(null)

    useEffect(() => {
        let cancelled = false
        void listPublishedAction(agentId).then(list => {
            if (!cancelled) setFiles(list)
        })
        return () => {
            cancelled = true
        }
    }, [agentId])

    const replace = useCallback((file: PublishedFile) => setFiles(list => list?.map(other => (other.slug === file.slug ? file : other)) ?? null), [])
    const remove = useCallback((slug: string) => setFiles(list => list?.filter(other => other.slug !== slug) ?? null), [])

    if (files?.length === 0) {
        return <EmptyState icon={GlobeIcon} title={t('emptyTitle')} description={t('emptyDescription', { agent: agentName })} />
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
                {files === null
                    ? Array.from({ length: SKELETON_ROWS }, (_, index) => <PublishedRowSkeleton key={index} />)
                    : files.map(file => (
                          <PanelRow
                              key={file.slug}
                              onClick={() => setSharing(file)}
                              leading={<PublishedThumb file={file} className="w-16 shrink-0" />}
                              title={file.title}
                              meta={<AccessBadge access={file.access} />}
                              description={<span className="block truncate font-mono text-[11px]">{publishedHostOf(file.url)}</span>}
                              footer={t('updated', { when: relativeDate(file.updatedAt, locale) })}
                              actions={
                                  <>
                                      <Button
                                          variant="ghost"
                                          size="icon-sm"
                                          aria-label={t('copyLink')}
                                          className="@max-sm:hidden"
                                          onClick={event => {
                                              event.stopPropagation()
                                              void navigator.clipboard.writeText(file.url)
                                          }}
                                      >
                                          <CopyIcon />
                                      </Button>
                                      <PublishedRowMenu file={file} onShare={() => setSharing(file)} onUnpublished={remove} />
                                  </>
                              }
                          />
                      ))}
            </div>
            <ShareDialog open={sharing !== null} onOpenChange={open => !open && setSharing(null)} slug={sharing?.slug ?? null} initial={sharing} onChanged={replace} onUnpublished={remove} />
        </div>
    )
}

export function PublishedRowSkeleton() {
    return (
        <div className={cn(PANEL_CARD, 'flex items-center gap-3 p-3')}>
            <Skeleton className="aspect-[16/10] w-16 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-2.5 w-1/4" />
            </div>
        </div>
    )
}
