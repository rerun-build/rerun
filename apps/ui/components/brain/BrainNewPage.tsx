'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { saveBrainPageAction } from '@/app/api/_actions/brain.actions'
import { BrainEditor, type BrainEditorHandle } from '@/components/brain/editor/BrainEditor'
import { BrainBoxProperty, useFilingCrumbs } from '@/components/brain/BrainItemProperties'
import { PageColumn, PageProperty, PageTitle, PageTypeIcon, PageTypeSelect } from '@/components/brain/BrainPageParts'
import { BrainTopBar } from '@/components/brain/BrainTopBar'
import type { SharedFileRef } from '@/components/brain/useSharedFilesTree'
import type { BrainBox } from '@/lib/brain/items'
import { brainSlugify } from '@/lib/brain/labels'
import { BRAIN_PAGE_ICONS } from '@/lib/brain/page-icons'
import type { BrainPageDetail } from '@/lib/engine/client'
import type { BrainPageSummary, BrainPageType } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

// The page being written before it exists: the sidebar shows it in its Box as it is typed.
export type BrainNewPageDraft = { title: string; type: BrainPageType; spaceId: string | null }

type BrainNewPageProps = {
    draft: BrainNewPageDraft
    boxes: BrainBox[]
    onDraftChange: (draft: BrainNewPageDraft) => void
    pages: BrainPageSummary[]
    titles: Map<string, string>
    files: SharedFileRef[]
    onOpenPage: (slug: string) => void
    onOpenFile: (path: string) => void
    onCreated: (detail: BrainPageDetail) => void
}

// Nothing is written while the title is empty. The first time it is left with something in it, the
// page is created under the slug its title gives, and that slug stays: renaming later only changes
// the title, so the [[links]] other pages hold keep working.
export function BrainNewPage({ draft, boxes, onDraftChange, pages, titles, files, onOpenPage, onOpenFile, onCreated }: BrainNewPageProps) {
    const t = useTranslations('brain')
    const errorText = useErrorText()
    const filingCrumbs = useFilingCrumbs()
    const { title, type, spaceId } = draft
    const [error, setError] = useState<string | null>(null)
    const [creating, setCreating] = useState(false)
    const content = useRef('')
    // Enter commits the title, then moves the focus to the body, which blurs the title and commits
    // it a second time in the same tick: the state alone would not see the first one yet.
    const started = useRef(false)
    const editorHandle = useRef<BrainEditorHandle>(null)

    const create = async () => {
        const trimmed = title.trim()
        if (!trimmed || started.current) return
        const slug = brainSlugify(trimmed)
        if (!slug) {
            setError(t('newPage.slugInvalid'))
            return
        }
        if (titles.has(slug)) {
            setError(t('newPage.exists', { title: titles.get(slug) ?? slug }))
            return
        }
        started.current = true
        setCreating(true)
        const result = await saveBrainPageAction(slug, { title: trimmed, type, content: content.current, sources: [], baseHash: null }, spaceId ? { spaceId } : undefined)
        setCreating(false)
        if (!result.ok) {
            started.current = false
            setError(errorText(result))
            return
        }
        onCreated(result.detail)
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <BrainTopBar crumbs={[...(spaceId ? filingCrumbs(spaceId, boxes) : [{ label: t('crumbs.pages') }]), { label: title.trim() || (spaceId ? t('crumbs.untitled') : t('crumbs.newPage')), icon: BRAIN_PAGE_ICONS[type] }]} status={creating ? t('page.saving') : null} />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <PageColumn>
                    <PageTypeIcon type={type} />
                    <PageTitle
                        value={title}
                        autoFocus
                        onChange={next => {
                            onDraftChange({ ...draft, title: next })
                            setError(null)
                        }}
                        onCommit={() => void create()}
                        onEnter={() => editorHandle.current?.focus('start')}
                    />
                    {error ? (
                        <p className="mt-1 text-xs text-destructive">{error}</p>
                    ) : (
                        title.trim() && <p className="mt-1 text-xs text-muted-foreground">{t('newPage.linkHint', { slug: brainSlugify(title) })}</p>
                    )}

                    <div className="mt-4 space-y-0.5 border-b border-border pb-4">
                        <PageProperty label={t('page.type')}>
                            <PageTypeSelect value={type} onChange={next => onDraftChange({ ...draft, type: next })} />
                        </PageProperty>
                        {boxes.length > 0 && <BrainBoxProperty spaceId={spaceId} boxes={boxes} onChange={next => onDraftChange({ ...draft, spaceId: next })} />}
                    </div>

                    <BrainEditor
                        className="mt-6"
                        content=""
                        pages={pages}
                        titles={titles}
                        files={files}
                        handleRef={editorHandle}
                        placeholder={t('newPage.placeholder')}
                        onOpenPage={onOpenPage}
                        onOpenFile={onOpenFile}
                        onChange={markdown => (content.current = markdown)}
                        onBlur={() => void create()}
                    />
                </PageColumn>
            </div>
        </div>
    )
}
