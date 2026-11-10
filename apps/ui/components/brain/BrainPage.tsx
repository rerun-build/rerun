'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { BrainEditor, type BrainEditorHandle } from '@/components/brain/editor/BrainEditor'
import { PageColumn, PageProperty, PageTitle, PageTypeIcon, PageTypeSelect, UnconfirmedSections } from '@/components/brain/BrainPageParts'
import { BrainTopBar } from '@/components/brain/BrainTopBar'
import type { SharedFileRef } from '@/components/brain/useSharedFilesTree'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { confirmBrainSectionsAction } from '@/app/api/_actions/brain.actions'
import { useBrainAutosave, type AutosaveStatus } from '@/hooks/useBrainAutosave'
import { brainAuthorLabel, brainSourceLabels, isCardType } from '@/lib/brain/labels'
import { BRAIN_PAGE_ICONS } from '@/lib/brain/page-icons'
import type { BrainPageDetail } from '@/lib/engine/client'
import { ChevronRightIcon, CopyIcon, EllipsisIcon, HistoryIcon, Trash2Icon } from '@/lib/icons'
import { shortRelativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { BrainPage as BrainPageData, BrainPageSummary, BrainPageType, BrainProposal } from '@rerun/contracts'
import { Badge } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

type BrainPageProps = {
    detail: BrainPageDetail
    pages: BrainPageSummary[]
    titles: Map<string, string>
    files: SharedFileRef[]
    proposal: BrainProposal | null
    onOpenPage: (slug: string) => void
    onOpenFile: (path: string) => void
    onReviewProposals: () => void
    onSaved: (detail: BrainPageDetail) => void
    onHistory: () => void
    onDelete: () => Promise<void>
}

type PageTranslator = ReturnType<typeof useTranslations<'brain.page'>>

function saveLabel(status: AutosaveStatus, page: BrainPageData, locale: string, t: PageTranslator): string | null {
    if (status === 'pending' || status === 'saving') return t('saving')
    if (status === 'saved') return t('saved')
    if (status === 'error') return t('notSaved')
    if (status === 'conflict') return null
    return page.updatedAt ? t('edited', { time: shortRelativeTime(page.updatedAt, locale) }) : null
}

function Backlinks({ links, onOpenPage }: { links: BrainPageData['backlinks']; onOpenPage: (slug: string) => void }) {
    const t = useTranslations('brain.page')
    const [open, setOpen] = useState(false)
    if (links.length === 0) return null
    return (
        <div className="mt-12 border-t border-border pt-4">
            <button type="button" onClick={() => setOpen(value => !value)} className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground" aria-expanded={open}>
                <ChevronRightIcon className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')} />
                {t('backlinks', { count: links.length })}
            </button>
            {open && (
                <div className="mt-2 space-y-0.5">
                    {links.map(link => (
                        <button key={link.slug} type="button" onClick={() => onOpenPage(link.slug)} className="block w-full rounded-md px-2 py-1 text-left text-sm underline decoration-foreground/30 underline-offset-2 transition-colors hover:bg-accent hover:decoration-foreground">
                            {link.title}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// A brain page is its own editor: the title, the type and the body are typed in place and saved as
// they change, the way Notion does it.
export function BrainPage({ detail, pages, titles, files, proposal, onOpenPage, onOpenFile, onReviewProposals, onSaved, onHistory, onDelete }: BrainPageProps) {
    const t = useTranslations('brain')
    const tPage = useTranslations('brain.page')
    const errorText = useErrorText()
    const locale = useLocale()
    const page = detail.page
    const autosave = useBrainAutosave({ page, onSaved })
    const [title, setTitle] = useState(page.title)
    const [type, setType] = useState<BrainPageType>(page.type)
    const [content, setContent] = useState(page.content)
    const [editorKey, setEditorKey] = useState(0)
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [confirming, setConfirming] = useState(false)
    const editorHandle = useRef<BrainEditorHandle>(null)

    const loadTheirs = async () => {
        const latest = await autosave.loadTheirs()
        if (!latest) return
        setTitle(latest.title)
        setType(latest.type)
        setContent(latest.content)
        setEditorKey(key => key + 1)
    }

    const remove = async () => {
        setDeleting(true)
        await onDelete()
        setDeleting(false)
        setConfirmingDelete(false)
    }

    const confirm = async () => {
        setConfirming(true)
        const result = await confirmBrainSectionsAction(page.slug, null)
        setConfirming(false)
        if (result.ok) onSaved(result.detail)
        else toast.error(errorText(result))
    }

    const section = isCardType(type) ? t('crumbs.company') : t('crumbs.pages')
    const status = saveLabel(autosave.status, page, locale, tPage)

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <BrainTopBar crumbs={[{ label: section }, { label: title.trim() || t('crumbs.untitled'), icon: BRAIN_PAGE_ICONS[type] }]} status={status && <span className={cn(autosave.status === 'error' && 'text-destructive')} title={autosave.error ?? undefined}>{status}</span>}>
                <Button size="icon-sm" variant="ghost" onClick={onHistory} aria-label={tPage('versionHistory')} title={tPage('versionHistory')}>
                    <HistoryIcon />
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label={tPage('more')} title={tPage('more')}>
                            <EllipsisIcon />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                            onSelect={() => {
                                void navigator.clipboard.writeText(`[[${page.slug}]]`)
                                toast.success(tPage('linkCopied'), { description: tPage('linkCopiedHint', { link: `[[${page.slug}]]` }) })
                            }}
                        >
                            <CopyIcon /> {tPage('copyLink')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={onHistory}>
                            <HistoryIcon /> {tPage('versionHistory')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
                            <Trash2Icon /> {tPage('delete')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </BrainTopBar>

            {autosave.status === 'conflict' && (
                <div className="flex flex-wrap items-center gap-2 border-y border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                        {tPage.rich('conflict', {
                            name: autosave.conflictWith ? brainAuthorLabel(autosave.conflictWith.updatedBy, t) : tPage('someone'),
                            b: chunks => <span className="font-medium">{chunks}</span>,
                        })}
                    </span>
                    <Button size="xs" variant="outline" onClick={loadTheirs}>
                        {tPage('loadTheirs')}
                    </Button>
                    <Button size="xs" onClick={() => void autosave.keepMine()}>
                        {tPage('keepMine')}
                    </Button>
                </div>
            )}

            {proposal && autosave.status !== 'conflict' && (
                <div className="flex items-center gap-2 border-y border-border bg-muted/40 px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                        {tPage.rich('proposes', {
                            name: proposal.agentName,
                            b: chunks => <span className="font-medium">{chunks}</span>,
                            muted: chunks => <span className="text-muted-foreground">{chunks}</span>,
                        })}
                    </span>
                    <Button size="xs" variant="outline" onClick={onReviewProposals}>
                        {tPage('review')}
                    </Button>
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
                <PageColumn>
                    <PageTypeIcon type={type} />
                    <PageTitle
                        value={title}
                        onChange={next => {
                            setTitle(next)
                            autosave.edit({ title: next })
                        }}
                        onEnter={() => editorHandle.current?.focus('start')}
                    />
                    {!title.trim() && <p className="mt-1 text-xs text-muted-foreground">{tPage('titleRequired')}</p>}

                    <div className="mt-4 space-y-0.5 border-b border-border pb-4">
                        <PageProperty label={tPage('type')}>
                            <PageTypeSelect
                                value={type}
                                onChange={next => {
                                    setType(next)
                                    autosave.edit({ type: next })
                                }}
                            />
                        </PageProperty>
                        {page.sources.length > 0 && (
                            <PageProperty label={tPage('sources')}>
                                {brainSourceLabels(page.sources, t).map(source => (
                                    <Badge key={source} size="xs" tone="neutral" glow={false} fill="outline">
                                        {source}
                                    </Badge>
                                ))}
                            </PageProperty>
                        )}
                        {page.unconfirmed.length > 0 && <UnconfirmedSections headings={page.unconfirmed} confirming={confirming} onConfirm={() => void confirm()} />}
                        {page.updatedAt && (
                            <PageProperty label={tPage('lastEdited')}>
                                <span className="text-foreground/80">
                                    {tPage('lastEditedValue', { time: shortRelativeTime(page.updatedAt, locale), author: brainAuthorLabel(page.updatedBy, t) })}
                                </span>
                            </PageProperty>
                        )}
                    </div>

                    <BrainEditor
                        key={editorKey}
                        className="mt-6"
                        content={content}
                        pages={pages}
                        titles={titles}
                        files={files}
                        currentSlug={page.slug}
                        handleRef={editorHandle}
                        onOpenPage={onOpenPage}
                        onOpenFile={onOpenFile}
                        onChange={markdown => autosave.edit({ content: markdown })}
                        onBlur={() => void autosave.flush()}
                    />

                    <Backlinks links={page.backlinks} onOpenPage={onOpenPage} />
                </PageColumn>
            </div>

            <ConfirmDialog
                open={confirmingDelete}
                onOpenChange={setConfirmingDelete}
                pending={deleting}
                title={tPage('deleteTitle', { title: page.title })}
                description={tPage('deleteDescription')}
                onConfirm={() => void remove()}
            />
        </div>
    )
}
