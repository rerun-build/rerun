'use client'

import type { SharedFileRef } from '@/components/brain/useSharedFilesTree'
import { cn } from '@/lib/utils'
import type { BrainPageSummary } from '@rerun/contracts'
import { richTextClassName } from '@rerun/ui/rich-text-editor'
import { PluginKey } from '@tiptap/pm/state'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { exitSuggestion } from '@tiptap/suggestion'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'

import { BrainBubbleMenu } from './BrainBubbleMenu'
import { brainExtensions, editorMarkdown } from './extensions'
import { SHARED_FILE_DRAG_TYPE } from './file-link'
import { pickerItems, slashItems, type PickerMode } from './menu-items'
import { SuggestionMenu, suggestionMenu, type MenuState } from './suggestion-menu'

export type BrainEditorHandle = { focus: (position?: 'start' | 'end') => void }

type BrainEditorProps = {
    // Read once at mount: the caller remounts the editor (a new `key`) to load another version.
    content: string
    editable?: boolean
    pages?: BrainPageSummary[]
    titles: Map<string, string>
    files?: SharedFileRef[]
    currentSlug?: string | null
    placeholder?: string
    className?: string
    handleRef?: Ref<BrainEditorHandle>
    onOpenPage?: (slug: string) => void
    onOpenFile?: (path: string) => void
    // Only ever called for an edit the person made. Opening a page never calls it, even though
    // TipTap normalises the markdown it was given.
    onChange?: (markdown: string) => void
    onBlur?: () => void
}

type OpenMenu = { kind: 'slash' | 'picker'; mode: PickerMode; state: MenuState; position: { top: number; left: number } }

const SLASH_MENU = new PluginKey('brainSlashMenu')
const PAGE_PICKER = new PluginKey('brainPagePicker')

const MENU_HEIGHT = 320
const MENU_WIDTH = 288

// The page body as Notion edits it: no toolbar, `/` for blocks, `[[` to link a page or a file,
// formatting on the selection. Reads and writes the same markdown agents read.
export function BrainEditor({ content, editable = true, pages = [], titles, files = [], currentSlug = null, placeholder, className, handleRef, onOpenPage, onOpenFile, onChange, onBlur }: BrainEditorProps) {
    const t = useTranslations('brain.editor')
    const containerRef = useRef<HTMLDivElement>(null)
    const [menu, setMenu] = useState<OpenMenu | null>(null)
    const [menuIndex, setMenuIndex] = useState(0)

    // The extensions are built once; everything they read that changes over time goes through here.
    const live = useRef({ t, pages, titles, files, currentSlug, onOpenPage, onOpenFile, onChange, onBlur, menu, menuIndex, pickerMode: 'pages' as PickerMode })
    useEffect(() => {
        Object.assign(live.current, { t, pages, titles, files, currentSlug, onOpenPage, onOpenFile, onChange, onBlur, menu, menuIndex })
    })

    const handleMenuKey = useCallback((event: KeyboardEvent) => {
        const open = live.current.menu
        if (!open) return false
        const count = open.state.items.length
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (count) setMenuIndex(index => (index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count)
            return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
            const item = open.state.items[live.current.menuIndex]
            if (!item) return false
            open.state.command(item)
            return true
        }
        return false
    }, [])

    const showMenu = useCallback((kind: OpenMenu['kind'], state: MenuState | null) => {
        setMenuIndex(0)
        const box = containerRef.current?.getBoundingClientRect()
        if (!state?.rect || !box) {
            setMenu(null)
            return
        }
        const { rect } = state
        const below = rect.bottom + MENU_HEIGHT < window.innerHeight
        const position = { top: below ? rect.bottom - box.top + 6 : rect.top - box.top - MENU_HEIGHT - 6, left: Math.max(0, Math.min(rect.left - box.left, box.width - MENU_WIDTH)) }
        setMenu({ kind, mode: live.current.pickerMode, state, position })
    }, [])

    // The callbacks below only read `live` when ProseMirror calls them, on a keystroke or a click,
    // never while rendering: the rule cannot tell a ref handed to a closure from one read in render.
    /* eslint-disable react-hooks/refs */
    const extensions = useMemo(
        () => [
            ...brainExtensions({
                titleOf: slug => live.current.titles.get(slug),
                onOpenPage: slug => live.current.onOpenPage?.(slug),
                onOpenFile: path => live.current.onOpenFile?.(path),
                placeholder: placeholder ?? t('placeholder'),
            }),
            suggestionMenu({
                name: 'brainSlashMenu',
                pluginKey: SLASH_MENU,
                char: '/',
                items: query => slashItems(query, mode => (live.current.pickerMode = mode), live.current.t),
                onState: state => showMenu('slash', state),
                onKeyDown: handleMenuKey,
            }),
            suggestionMenu({
                name: 'brainPagePicker',
                pluginKey: PAGE_PICKER,
                char: '[[',
                allowSpaces: true,
                allowedPrefixes: null,
                items: query => pickerItems(query, live.current.pickerMode, live.current.pages, live.current.files, live.current.currentSlug, live.current.t),
                onState: state => {
                    showMenu('picker', state)
                    if (!state) live.current.pickerMode = 'pages'
                },
                onKeyDown: handleMenuKey,
            }),
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    )
    /* eslint-enable react-hooks/refs */

    // TipTap reformats markdown it did not write itself. The first serialisation is the untouched
    // baseline: matching it again hands back the original text rather than the reformatted one.
    const baseline = useRef<string | null>(null)
    const emitted = useRef(content)

    const editor = useEditor({
        immediatelyRender: false,
        editable,
        extensions,
        content,
        editorProps: {
            attributes: {
                class: cn(richTextClassName, 'min-h-48 text-[15px] leading-7 text-foreground/85 outline-none [&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:text-muted-foreground/60 [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-foreground'),
            },
            handleDrop: (view, event) => {
                const raw = event.dataTransfer?.getData(SHARED_FILE_DRAG_TYPE)
                if (!raw) return false
                const file = JSON.parse(raw) as SharedFileRef
                const position = view.posAtCoords({ left: event.clientX, top: event.clientY })
                if (!position) return false
                event.preventDefault()
                const node = view.state.schema.nodes.fileLink.create({ path: file.path, name: file.name })
                view.dispatch(view.state.tr.insert(position.pos, node))
                view.focus()
                return true
            },
        },
        onCreate: ({ editor: created }) => {
            baseline.current = editorMarkdown(created)
        },
        onUpdate: ({ editor: updated }) => {
            const markdown = editorMarkdown(updated)
            // TipTap can report an update before onCreate: nobody has typed yet, it is the baseline.
            if (baseline.current === null) {
                baseline.current = markdown
                return
            }
            const next = markdown === baseline.current ? content : markdown
            // TipTap also reports the transactions it appends on its own once the page is open.
            if (next === emitted.current) return
            emitted.current = next
            live.current.onChange?.(next)
        },
        onBlur: () => live.current.onBlur?.(),
    })

    useEffect(() => {
        editor?.setEditable(editable)
    }, [editor, editable])

    // Radix closes the dialog on Escape from a capture listener on the document, before the editor
    // sees the key. Escape inside the page closes its menu, then leaves the editor, and only a
    // second one closes the dialog.
    useEffect(() => {
        if (!editor) return
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !(event.target instanceof Node) || !containerRef.current?.contains(event.target)) return
            event.preventDefault()
            const open = live.current.menu
            if (open) {
                exitSuggestion(editor.view, open.kind === 'slash' ? SLASH_MENU : PAGE_PICKER)
                setMenu(null)
                return
            }
            if (event.target instanceof HTMLInputElement) return
            editor.commands.blur()
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [editor])

    useImperativeHandle(handleRef, () => ({ focus: position => editor?.commands.focus(position ?? 'start') }), [editor])

    return (
        <div ref={containerRef} className={cn('relative', className)} data-vaul-no-drag>
            <EditorContent editor={editor} />
            {editor && editable && <BrainBubbleMenu editor={editor as Editor} />}
            {menu && (
                <SuggestionMenu
                    state={menu.state}
                    index={menuIndex}
                    position={menu.position}
                    emptyLabel={menu.kind === 'slash' ? t('noBlock') : menu.mode === 'files' ? t('noFile') : t('noPage')}
                    onHover={setMenuIndex}
                />
            )}
        </div>
    )
}
