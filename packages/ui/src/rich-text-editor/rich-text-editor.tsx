'use client'

import * as React from 'react'
import { Extension, EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { Bold, CodeIcon, Heading2, Heading3, Italic, LinkIcon, ListIcon, ListOrdered, Quote, SquareCode, type LucideIcon } from '../icons'

import { cn } from '../cn'
import { richTextClassName } from './rich-text-styles'
import { useKitTranslations } from '../locale'

interface RichTextEditorProps {
    value: string
    onChange: (markdown: string) => void
    placeholder?: string
    id?: string
    contentClassName?: string
    autoFocus?: boolean
    onSubmitShortcut?: () => void
}

export function RichTextEditor({ value, onChange, placeholder, id, contentClassName, autoFocus, onSubmitShortcut }: RichTextEditorProps) {
    const lastEmitted = React.useRef(value)

    // StarterKit's HardBreak already claims Mod-Enter, so the shortcut has to outrank it from
    // inside the editor. Read through a ref: the extension list is only built once.
    const submitRef = React.useRef(onSubmitShortcut)
    React.useEffect(() => {
        submitRef.current = onSubmitShortcut
    })

    const submitShortcut = React.useMemo(
        () =>
            Extension.create({
                name: 'submitShortcut',
                priority: 1000,
                addKeyboardShortcuts: () => ({
                    'Mod-Enter': () => {
                        const submit = submitRef.current
                        if (!submit) return false
                        submit()
                        return true
                    },
                }),
            }),
        [],
    )

    const editor = useEditor({
        immediatelyRender: false,
        autofocus: autoFocus ? 'end' : false,
        extensions: [
            submitShortcut,
            StarterKit.configure({
                heading: { levels: [2, 3] },
                link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] },
            }),
            Markdown.configure({ html: false, linkify: true }),
        ],
        content: value,
        editorProps: {
            attributes: {
                class: cn(
                    richTextClassName,
                    'min-h-28 w-full rounded-b-lg bg-background px-3 py-2 text-sm text-foreground/70 outline-none',
                    contentClassName,
                ),
            },
        },
        onUpdate: ({ editor }) => {
            const markdown = (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
            lastEmitted.current = markdown
            onChange(markdown)
        },
    })

    React.useEffect(() => {
        if (!editor) return
        if (value === lastEmitted.current) return
        if (editor.isFocused) return
        lastEmitted.current = value
        editor.commands.setContent(value)
    }, [editor, value])

    return (
        <div className="rounded-lg border border-input bg-background transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
            <Toolbar editor={editor} />
            <EditorContent editor={editor} id={id} data-placeholder={placeholder} />
        </div>
    )
}

function Toolbar({ editor }: { editor: Editor | null }) {
    const t = useKitTranslations()
    const active = useEditorState({
        editor,
        selector: ({ editor }) => ({
            bold: editor?.isActive('bold') ?? false,
            italic: editor?.isActive('italic') ?? false,
            h2: editor?.isActive('heading', { level: 2 }) ?? false,
            h3: editor?.isActive('heading', { level: 3 }) ?? false,
            bulletList: editor?.isActive('bulletList') ?? false,
            orderedList: editor?.isActive('orderedList') ?? false,
            blockquote: editor?.isActive('blockquote') ?? false,
            code: editor?.isActive('code') ?? false,
            codeBlock: editor?.isActive('codeBlock') ?? false,
            link: editor?.isActive('link') ?? false,
        }),
    })

    if (!editor || !active) return null

    const setLink = () => {
        const previous = editor.getAttributes('link').href as string | undefined
        const url = window.prompt(t('richText.linkPrompt'), previous ?? 'https://')
        if (url === null) return
        if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            return
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }

    return (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-input p-1">
            <ToolbarButton icon={Bold} label={t('richText.bold')} active={active.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
            <ToolbarButton icon={Italic} label={t('richText.italic')} active={active.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
            <Divider />
            <ToolbarButton icon={Heading2} label={t('richText.heading')} active={active.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
            <ToolbarButton icon={Heading3} label={t('richText.subheading')} active={active.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
            <Divider />
            <ToolbarButton icon={ListIcon} label={t('richText.bulletList')} active={active.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()} />
            <ToolbarButton icon={ListOrdered} label={t('richText.numberedList')} active={active.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
            <ToolbarButton icon={Quote} label={t('richText.quote')} active={active.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
            <Divider />
            <ToolbarButton icon={CodeIcon} label={t('richText.inlineCode')} active={active.code} onClick={() => editor.chain().focus().toggleCode().run()} />
            <ToolbarButton icon={SquareCode} label={t('richText.codeBlock')} active={active.codeBlock} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
            <Divider />
            <ToolbarButton icon={LinkIcon} label={t('richText.link')} active={active.link} onClick={setLink} />
        </div>
    )
}

function ToolbarButton({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            aria-pressed={active}
            title={label}
            className={cn(
                'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                active && 'bg-muted text-foreground',
            )}
        >
            <Icon className="size-4" />
        </button>
    )
}

function Divider() {
    return <span className="mx-0.5 h-4 w-px bg-input" />
}
