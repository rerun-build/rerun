import type { SharedFileRef } from '@/components/brain/useSharedFilesTree'
import { BRAIN_PAGE_ICONS } from '@/lib/brain/page-icons'
import { CodeIcon, FileIcon, Heading2, Heading3, LinkIcon, ListIcon, ListOrdered, ListTodo, MinusIcon, Quote, TypeIcon } from '@/lib/icons'
import type { BrainPageSummary } from '@rerun/contracts'
import type { useTranslations } from 'next-intl'

import type { FileLinkAttrs } from './file-link'
import type { MenuItem } from './suggestion-menu'
import type { WikilinkAttrs } from './wikilink'

const MAX_RESULTS = 8

// `/Link to page` and `/File` both hand over to the `[[` picker, which then lists one or the other.
export type PickerMode = 'pages' | 'files'

export type EditorTranslator = ReturnType<typeof useTranslations<'brain.editor'>>

export function slashItems(query: string, openPicker: (mode: PickerMode) => void, t: EditorTranslator): MenuItem[] {
    const items: MenuItem[] = [
        { id: 'text', label: t('slash.text'), icon: TypeIcon, run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run() },
        { id: 'heading', label: t('slash.heading'), icon: Heading2, run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run() },
        { id: 'subheading', label: t('slash.subheading'), icon: Heading3, run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run() },
        { id: 'bulleted', label: t('slash.bulleted'), icon: ListIcon, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
        { id: 'numbered', label: t('slash.numbered'), icon: ListOrdered, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
        { id: 'todo', label: t('slash.todo'), icon: ListTodo, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run() },
        { id: 'quote', label: t('slash.quote'), icon: Quote, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
        { id: 'divider', label: t('slash.divider'), icon: MinusIcon, run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
        { id: 'code', label: t('slash.code'), icon: CodeIcon, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
        {
            id: 'page-link',
            label: t('slash.pageLink'),
            hint: t('slash.pageLinkHint'),
            icon: LinkIcon,
            run: (editor, range) => {
                openPicker('pages')
                editor.chain().focus().deleteRange(range).insertContent('[[').run()
            },
        },
        {
            id: 'file',
            label: t('slash.file'),
            hint: t('slash.fileHint'),
            icon: FileIcon,
            run: (editor, range) => {
                openPicker('files')
                editor.chain().focus().deleteRange(range).insertContent('[[').run()
            },
        },
    ]
    const needle = query.trim().toLowerCase()
    return needle ? items.filter(item => item.label.toLowerCase().includes(needle) || item.id.includes(needle)) : items
}

const insertWikilink = (attrs: WikilinkAttrs): MenuItem['run'] => (editor, range) =>
    editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
            { type: 'wikilink', attrs },
            { type: 'text', text: ' ' },
        ])
        .run()

export const insertFileLink = (attrs: FileLinkAttrs): MenuItem['run'] => (editor, range) =>
    editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
            { type: 'fileLink', attrs },
            { type: 'text', text: ' ' },
        ])
        .run()

export function pickerItems(query: string, mode: PickerMode, pages: BrainPageSummary[], files: SharedFileRef[], currentSlug: string | null, t: EditorTranslator): MenuItem[] {
    const needle = query.trim().toLowerCase()
    if (mode === 'files') {
        return files
            .filter(file => !needle || file.path.toLowerCase().includes(needle))
            .slice(0, MAX_RESULTS * 2)
            .map(file => ({ id: `file:${file.path}`, label: file.name, hint: file.path === file.name ? undefined : file.path, icon: FileIcon, group: t('groups.files'), run: insertFileLink(file) }))
    }
    const matchingPages = pages
        .filter(page => page.slug !== currentSlug)
        .filter(page => !needle || page.title.toLowerCase().includes(needle) || page.slug.includes(needle))
        .slice(0, MAX_RESULTS)
        .map(page => ({ id: `page:${page.slug}`, label: page.title, icon: BRAIN_PAGE_ICONS[page.type], group: t('groups.pages'), run: insertWikilink({ target: page.slug, label: null }) }))
    const matchingFiles = needle
        ? files
              .filter(file => file.path.toLowerCase().includes(needle))
              .slice(0, 4)
              .map(file => ({ id: `file:${file.path}`, label: file.name, hint: file.path === file.name ? undefined : file.path, icon: FileIcon, group: t('groups.files'), run: insertFileLink(file) }))
        : []
    return [...matchingPages, ...matchingFiles]
}
