'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { saveBrainPageAction } from '@/app/api/_actions/brain.actions'
import { BrainEditor, type BrainEditorHandle } from '@/components/brain/editor/BrainEditor'
import { PageColumn, PageProperty, PageTitle, PageTypeIcon, PageTypeSelect } from '@/components/brain/BrainPageParts'
import { BrainTopBar } from '@/components/brain/BrainTopBar'
import type { SharedFileRef } from '@/components/brain/useSharedFilesTree'
import { brainSlugify } from '@/lib/brain/labels'
import { BRAIN_PAGE_ICONS } from '@/lib/brain/page-icons'
import type { BrainPageDetail } from '@/lib/engine/client'
import type { BrainPageSummary, BrainPageType } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

type BrainNewPageProps = {
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
export function BrainNewPage({ pages, titles, files, onOpenPage, onOpenFile, onCreated }: BrainNewPageProps) {
    const t = useTranslations('brain')
    const errorText = useErrorText()
    const [title, setTitle] = useState('')
    const [type, setType] = useState<BrainPageType>('note')
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
        const result = await saveBrainPageAction(slug, { title: trimmed, type, content: content.current, sources: [], baseHash: null })
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
            <BrainTopBar crumbs={[{ label: t('crumbs.pages') }, { label: title.trim() || t('crumbs.newPage'), icon: BRAIN_PAGE_ICONS[type] }]} status={creating ? t('page.saving') : null} />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <PageColumn>
                    <PageTypeIcon type={type} />
                    <PageTitle
                        value={title}
                        autoFocus
                        onChange={next => {
                            setTitle(next)
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
                            <PageTypeSelect value={type} onChange={setType} />
                        </PageProperty>
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
