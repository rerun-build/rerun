'use client'

import { cn } from '@/lib/utils'
import type { LucideIcon } from '@/lib/icons'
import { Extension, type Editor, type Range } from '@tiptap/core'
import type { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { Fragment, useEffect, useRef } from 'react'

export type MenuItem = {
    id: string
    label: string
    icon: LucideIcon
    group?: string
    hint?: string
    run: (editor: Editor, range: Range) => void
}

export type MenuState = { items: MenuItem[]; rect: DOMRect | null; command: (item: MenuItem) => void }

type SuggestionMenuOptions = {
    name: string
    pluginKey: PluginKey
    char: string
    allowSpaces?: boolean
    allowedPrefixes?: string[] | null
    items: (query: string) => MenuItem[]
    onState: (state: MenuState | null) => void
    onKeyDown: (event: KeyboardEvent) => boolean
}

export function suggestionMenu({ name, pluginKey, char, allowSpaces = false, allowedPrefixes = [' '], items, onState, onKeyDown }: SuggestionMenuOptions) {
    return Extension.create({
        name,
        addProseMirrorPlugins() {
            return [
                Suggestion<MenuItem, MenuItem>({
                    editor: this.editor,
                    pluginKey,
                    char,
                    allowSpaces,
                    allowedPrefixes,
                    items: ({ query }) => items(query),
                    command: ({ editor, range, props }) => props.run(editor, range),
                    render: () => {
                        const report = (props: { items: MenuItem[]; clientRect?: (() => DOMRect | null) | null; command: (item: MenuItem) => void }) =>
                            onState({ items: props.items, rect: props.clientRect?.() ?? null, command: props.command })
                        return {
                            onStart: report,
                            onUpdate: report,
                            onKeyDown: ({ event }) => onKeyDown(event),
                            onExit: () => onState(null),
                        }
                    },
                }),
            ]
        },
    })
}

type SuggestionMenuProps = {
    state: MenuState
    index: number
    position: { top: number; left: number }
    emptyLabel: string
    onHover: (index: number) => void
}

export function SuggestionMenu({ state, index, position, emptyLabel, onHover }: SuggestionMenuProps) {
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
    }, [index])

    return (
        <div
            ref={listRef}
            role="listbox"
            style={{ top: position.top, left: position.left }}
            className="absolute z-50 max-h-80 w-72 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
            onMouseDown={event => event.preventDefault()}
        >
            {state.items.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</p>}
            {state.items.map((item, itemIndex) => {
                const Glyph = item.icon
                const groupStarts = item.group && item.group !== state.items[itemIndex - 1]?.group
                return (
                    <Fragment key={item.id}>
                        {groupStarts && <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground first:pt-1">{item.group}</p>}
                        <button
                            type="button"
                            role="option"
                            aria-selected={itemIndex === index}
                            data-index={itemIndex}
                            onMouseEnter={() => onHover(itemIndex)}
                            onClick={() => state.command(item)}
                            className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm', itemIndex === index ? 'bg-accent text-accent-foreground' : 'text-foreground')}
                        >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                                <Glyph className="size-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate">{item.label}</span>
                                {item.hint && <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>}
                            </span>
                        </button>
                    </Fragment>
                )
            })}
        </div>
    )
}
