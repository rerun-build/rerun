'use client'

import { Bold, CheckIcon, CodeIcon, Heading2, Heading3, Italic, Link2OffIcon, LinkIcon, Strikethrough, type LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { TextSelection } from '@tiptap/pm/state'
import { useEditorState, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

function MenuButton({ icon: Glyph, label, active, onClick }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            className={cn('flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground', active ? 'bg-accent text-foreground' : 'text-muted-foreground')}
        >
            <Glyph className="size-3.5" />
        </button>
    )
}

const normalizeUrl = (value: string) => (/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`)

// Formatting on the selection, the way Notion shows it: nothing on screen until text is selected.
export function BrainBubbleMenu({ editor }: { editor: Editor }) {
    const t = useTranslations('brain.editor.bubble')
    const [linkDraft, setLinkDraft] = useState<string | null>(null)
    const active = useEditorState({
        editor,
        selector: ({ editor: current }) => ({
            bold: current.isActive('bold'),
            italic: current.isActive('italic'),
            strike: current.isActive('strike'),
            code: current.isActive('code'),
            link: current.isActive('link'),
            h2: current.isActive('heading', { level: 2 }),
            h3: current.isActive('heading', { level: 3 }),
        }),
    })

    const applyLink = () => {
        const url = linkDraft?.trim()
        const chain = editor.chain().focus().extendMarkRange('link')
        if (url) chain.setLink({ href: normalizeUrl(url) }).run()
        else chain.unsetLink().run()
        setLinkDraft(null)
    }

    return (
        <BubbleMenu
            editor={editor}
            options={{ placement: 'top', offset: 8, onHide: () => setLinkDraft(null) }}
            shouldShow={({ editor: current, state }) => current.isEditable && !state.selection.empty && state.selection instanceof TextSelection && !current.isActive('codeBlock')}
            className="z-50 flex items-center gap-0.5 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
            {linkDraft !== null ? (
                <form
                    className="flex items-center gap-1"
                    onSubmit={event => {
                        event.preventDefault()
                        applyLink()
                    }}
                >
                    <input
                        autoFocus
                        value={linkDraft}
                        onChange={event => setLinkDraft(event.target.value)}
                        onKeyDown={event => {
                            if (event.key !== 'Escape') return
                            event.preventDefault()
                            event.stopPropagation()
                            setLinkDraft(null)
                            editor.commands.focus()
                        }}
                        placeholder={t('pasteLink')}
                        aria-label={t('linkUrl')}
                        className="h-7 w-56 rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <MenuButton icon={CheckIcon} label={t('applyLink')} onClick={applyLink} />
                    {active.link && (
                        <MenuButton
                            icon={Link2OffIcon}
                            label={t('removeLink')}
                            onClick={() => {
                                editor.chain().focus().extendMarkRange('link').unsetLink().run()
                                setLinkDraft(null)
                            }}
                        />
                    )}
                </form>
            ) : (
                <>
                    <MenuButton icon={Heading2} label={t('heading')} active={active.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
                    <MenuButton icon={Heading3} label={t('subheading')} active={active.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
                    <span className="mx-0.5 h-4 w-px bg-border" />
                    <MenuButton icon={Bold} label={t('bold')} active={active.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
                    <MenuButton icon={Italic} label={t('italic')} active={active.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
                    <MenuButton icon={Strikethrough} label={t('strikethrough')} active={active.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
                    <MenuButton icon={CodeIcon} label={t('inlineCode')} active={active.code} onClick={() => editor.chain().focus().toggleCode().run()} />
                    <span className="mx-0.5 h-4 w-px bg-border" />
                    <MenuButton icon={LinkIcon} label={t('link')} active={active.link} onClick={() => setLinkDraft((editor.getAttributes('link').href as string | undefined) ?? '')} />
                </>
            )}
        </BubbleMenu>
    )
}
