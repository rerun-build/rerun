'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { dismissAccessRequestAction, getPublishedAction, updatePublishedAccessAction } from '@/app/api/_actions/publish.actions'
import { Button } from '@/components/ui/button'
import { PANEL_CARD } from '@/components/ui/panel-row'
import { Skeleton } from '@/components/ui/skeleton'
import { useAwaitedThumbnail } from '@/hooks/useAwaitedThumbnail'
import { openPublishedHref, publishedHostOf } from '@/lib/published/links'
import type { PublishResult, PublishedFile } from '@/lib/services/types'
import { ChevronDownIcon, ExternalLinkIcon, GlobeIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'

import { AccessIcon, useAccessCopy, useWorkspaceName } from './access'
import { PublishedThumb } from './PublishedThumb'
import { CopyLinkButton, ShareDialog } from './ShareDialog'

type Answer = 'public' | 'kept'

// A call made before links had an access carries neither its title nor its access: it was public.
function withDefaults(result: PublishResult): PublishResult {
    return { ...result, title: result.title ?? result.path, access: result.access ?? 'public', requestedAccess: result.requestedAccess ?? null }
}

// What a coworker published, drawn where it said so. The tool output only tells what the link was
// at that moment: the card reads it again, so a change made since (here or anywhere else) shows.
export function PublishedChatCard({ agentId, result: raw }: { agentId?: string; result: PublishResult }) {
    const t = useTranslations('published.chat')
    const errorText = useErrorText()
    const accessCopy = useAccessCopy()
    const result = withDefaults(raw)
    const workspaceName = useWorkspaceName()
    const coworkerName = useBoardStore(s => s.agents.find(agent => agent.id === agentId)?.name) ?? t('fallbackCoworker')
    const [live, setLive] = useState<PublishedFile | null | undefined>(undefined)
    const [answer, setAnswer] = useState<Answer | null>(null)
    const [answering, setAnswering] = useState<Answer | null>(null)
    const [shareOpen, setShareOpen] = useState(false)
    const slug = result.slug

    useEffect(() => {
        let cancelled = false
        void getPublishedAction(slug).then(file => {
            if (!cancelled) setLive(file)
        })
        return () => {
            cancelled = true
        }
    }, [slug])
    useAwaitedThumbnail(live, setLive)

    if (live === null) {
        return (
            <div className={cn(PANEL_CARD, 'flex w-full max-w-sm flex-col gap-0.5 p-3')}>
                <span className="truncate text-sm font-medium">{result.title}</span>
                <span className="text-xs text-muted-foreground">{t('unpublished')}</span>
            </div>
        )
    }

    const access = live?.access ?? result.access
    const asked = result.requestedAccess === 'public'
    const pending = answer === null && (live ? live.requestedAccess === 'public' : asked)
    const settled: Answer | null = answer ?? (asked && live && live.requestedAccess === null ? (live.access === 'public' ? 'public' : 'kept') : null)

    const respond = async (choice: Answer) => {
        setAnswering(choice)
        if (choice === 'public') {
            const outcome = await updatePublishedAccessAction(slug, { access: 'public' })
            setAnswering(null)
            if (!outcome.ok) return toast.error(t('updateFailed'), { description: errorText(outcome) })
            setLive(outcome.file)
        } else {
            const outcome = await dismissAccessRequestAction(slug)
            setAnswering(null)
            if (!outcome.ok) return toast.error(t('updateFailed'), { description: errorText(outcome) })
        }
        setAnswer(choice)
    }

    return (
        <div className={cn(PANEL_CARD, '@container flex w-full max-w-sm flex-col overflow-hidden p-0')}>
            <div className="bg-muted/40 p-3 pb-0">
                {live ? <PublishedThumb file={live} className="rounded-b-none" /> : <Skeleton className="aspect-[16/10] w-full rounded-b-none" />}
            </div>
            <div className="flex flex-col gap-2.5 p-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{live?.title ?? result.title}</span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">{publishedHostOf(live?.url ?? result.url)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => setShareOpen(true)} disabled={!live}>
                        <AccessIcon access={access} />
                        {accessCopy.short(access)}
                        {access === 'invited' && live && <span className="text-muted-foreground">· {live.invited.length}</span>}
                        <ChevronDownIcon className="text-muted-foreground" />
                    </Button>
                    <div className="ml-auto flex items-center gap-1">
                        <CopyLinkButton url={live?.url ?? result.url} label={t('copy')} variant="ghost" size="sm" />
                        <Button variant="outline" size="sm" asChild>
                            <a href={openPublishedHref(slug)} target="_blank" rel="noopener noreferrer">
                                <ExternalLinkIcon />
                                {t('open')}
                            </a>
                        </Button>
                    </div>
                </div>
            </div>
            {pending && (
                <div className="flex flex-wrap items-center gap-2 border-t bg-muted/50 px-3 py-2.5">
                    <GlobeIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 text-xs">{t('asksPublic', { coworker: coworkerName })}</span>
                    <div className="flex gap-1.5 @max-sm:w-full @max-sm:justify-end">
                        <Button variant="ghost" size="sm" loading={answering === 'kept'} disabled={answering !== null} onClick={() => void respond('kept')}>
                            {t('keepPrivate')}
                        </Button>
                        <Button size="sm" loading={answering === 'public'} disabled={answering !== null} onClick={() => void respond('public')}>
                            {t('makePublic')}
                        </Button>
                    </div>
                </div>
            )}
            {!pending && settled && <div className="border-t px-3 py-2.5 text-xs text-muted-foreground">{settled === 'public' ? (answer ? t('madePublicByYou') : t('madePublic')) : t('keptFor', { workspace: workspaceName })}</div>}
            <ShareDialog open={shareOpen} onOpenChange={setShareOpen} slug={slug} initial={live ?? null} onChanged={setLive} onUnpublished={() => setLive(null)} />
        </div>
    )
}
