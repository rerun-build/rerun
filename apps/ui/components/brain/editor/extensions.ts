import { Extension, type Editor, type Extensions } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'

import { FileLink } from './file-link'
import { Wikilink } from './wikilink'

const TightTaskLists = Extension.create({
    name: 'brainTightTaskLists',
    addGlobalAttributes: () => [
        {
            types: ['taskList'],
            attributes: {
                tight: {
                    default: true,
                    parseHTML: element => element.getAttribute('data-tight') === 'true' || !element.querySelector('p'),
                    renderHTML: attributes => (attributes.tight ? { 'data-tight': 'true' } : {}),
                },
            },
        },
    ],
})

export type BrainExtensionOptions = {
    titleOf?: (slug: string) => string | undefined
    onOpenPage?: (slug: string) => void
    onOpenFile?: (path: string) => void
    placeholder?: string
}

export function brainExtensions({ titleOf, onOpenPage, onOpenFile, placeholder }: BrainExtensionOptions = {}): Extensions {
    return [
        StarterKit.configure({
            heading: { levels: [1, 2, 3, 4] },
            underline: false,
            link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] },
        }),
        TaskList.configure({ HTMLAttributes: { class: '!list-none !pl-0' } }),
        TaskItem.configure({
            nested: true,
            HTMLAttributes: { class: 'flex items-start gap-2 [&>label]:mt-[0.4rem] [&>label]:shrink-0 [&>div]:min-w-0 [&>div]:flex-1 data-[checked=true]:[&>div]:text-muted-foreground data-[checked=true]:[&>div]:line-through' },
        }),
        TightTaskLists,
        Wikilink.configure({ titleOf: titleOf ?? (() => undefined), onOpen: onOpenPage ?? (() => {}) }),
        FileLink.configure({ onOpen: onOpenFile ?? (() => {}) }),
        ...(placeholder ? [Placeholder.configure({ placeholder, showOnlyWhenEditable: true })] : []),
        Markdown.configure({ html: false, linkify: true, transformPastedText: true, transformCopiedText: true }),
    ]
}

export const editorMarkdown = (editor: Editor) => (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
