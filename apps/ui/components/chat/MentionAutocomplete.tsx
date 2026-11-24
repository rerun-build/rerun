'use client'

import type { RemoteOs } from '@rerun/contracts'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { ComputerHandle, ComputerStatusBadge, OsTile } from '@/components/computers/ComputerBits'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { ComputerStatus } from '@/lib/computers/types'
import type { ComposerMention } from '@/lib/chat/composer-links'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react'

/** `hint` disambiguates two agents sharing a name, e.g. the Box each one lives in. `preferred` opens the list, e.g. the agents that share the Box of the conversation being typed in. */
export type MentionAgent = { id: string; name: string; handle: string | null; hint?: string; preferred?: boolean }
export type MentionSkill = { slug: string; name: string; description?: string }
/** A computer linked to the workspace, named `#handle` in a message. */
export type MentionComputer = { id: string; name: string; handle: string; os: RemoteOs; status: ComputerStatus }

export type MentionTrigger = '@' | '/' | '#'

const MENTION_TRIGGERS: readonly MentionTrigger[] = ['@', '/', '#']

/** The symbols a composer serves, and what types one at the caret from its footer's `@`. */
export type MentionCommands = { triggers: readonly MentionTrigger[]; onPick: (trigger: MentionTrigger) => void }

const COMMAND_KEY = { '@': 'coworker', '/': 'skill', '#': 'computer' } as const

type MentionItem = ({ kind: 'agent' } & MentionAgent) | ({ kind: 'skill' } & MentionSkill) | ({ kind: 'computer' } & MentionComputer)

type MentionState = { trigger: MentionTrigger; query: string; start: number }

function mentionText(item: MentionItem): string {
    if (item.kind === 'computer') return `#${item.handle}`
    return item.kind === 'skill' ? `/${item.slug}` : `@${item.handle || item.name}`
}

// Only a handle of a linked computer becomes a token: `#marketing` in a draft post stays text.
export function mentionTokensOf(agents: MentionAgent[], skills: MentionSkill[], computers: MentionComputer[] = []): ComposerMention[] {
    return [...agents.map(agent => ({ kind: 'agent' as const, ...agent })), ...skills.map(skill => ({ kind: 'skill' as const, ...skill })), ...computers.map(computer => ({ kind: 'computer' as const, ...computer }))].map(item => ({ text: mentionText(item), kind: item.kind }))
}

export type MentionMenuBox = { top: number; left: number; width: number }

// The menu lines up with the composer's frame (the `InputGroup` of `PromptInput`), or with the bare
// field of a pending question's answer, measured against the positioned box the menu is placed in.
export function mentionMenuBox(input: HTMLTextAreaElement, root: Element): MentionMenuBox {
    const frame = (input.closest('[data-slot="input-group"]') ?? input).getBoundingClientRect()
    const origin = root.getBoundingClientRect()
    return { top: frame.top - origin.top, left: frame.left - origin.left, width: frame.width }
}

const NO_SKILLS: MentionSkill[] = []
const NO_COMPUTERS: MentionComputer[] = []

// `null` for skills or computers: the list is not read yet, or could not be, so a bare symbol says what
// it does without claiming there is nothing behind it. `triggers`: the symbols this composer serves.
export function useMentionAutocomplete(
    agents: MentionAgent[],
    skills: MentionSkill[] | null = NO_SKILLS,
    onValueChange?: (text: string) => void,
    computers: MentionComputer[] | null = NO_COMPUTERS,
    onComputersWanted?: () => void,
    triggers: readonly MentionTrigger[] = MENTION_TRIGGERS
) {
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const [mention, setMention] = useState<MentionState | null>(null)
    const [highlight, setHighlight] = useState(0)
    // The text and caret a menu was shut on with Escape: a select event that changes neither, such as
    // React's own after a symbol was typed from the `@` button, must not open it again.
    const dismissedAt = useRef<string | null>(null)

    const items = useMemo<MentionItem[]>(() => {
        if (!mention) return []
        const query = mention.query.toLowerCase()
        if (mention.trigger === '#')
            return (computers ?? NO_COMPUTERS)
                .filter(c => c.name.toLowerCase().includes(query) || c.handle.includes(query))
                .map(c => ({ kind: 'computer' as const, ...c }))
                .sort((a, b) => Number(a.status === 'offline') - Number(b.status === 'offline') || a.name.localeCompare(b.name))
        if (mention.trigger === '/')
            return (skills ?? NO_SKILLS)
                .filter(s => s.name.toLowerCase().includes(query) || s.slug.toLowerCase().includes(query))
                .map(s => ({ kind: 'skill' as const, ...s }))
                .sort((a, b) => a.name.localeCompare(b.name))
        return agents
            .filter(a => [a.name, a.handle ?? '', a.hint ?? ''].some(field => field.toLowerCase().includes(query)))
            .map(a => ({ kind: 'agent' as const, ...a }))
            .sort((a, b) => Number(b.preferred ?? false) - Number(a.preferred ?? false) || a.name.localeCompare(b.name))
    }, [agents, skills, computers, mention])

    const tokens = useMemo(() => mentionTokensOf(agents, skills ?? NO_SKILLS, computers ?? NO_COMPUTERS), [agents, skills, computers])
    const listRead = mention?.trigger === '/' ? skills !== null : mention?.trigger === '#' ? computers !== null : true

    // A bare symbol always opens the menu, to say what it does even when there is nothing to pick;
    // once letters follow and nothing matches, `#marketing` in a draft stays plain text.
    const open = mention !== null && (items.length > 0 || mention.query === '')

    const detect = useCallback((el: HTMLTextAreaElement) => {
        const caret = el.selectionStart ?? 0
        if (dismissedAt.current === `${caret}:${el.value}`) return
        dismissedAt.current = null
        const before = el.value.slice(0, caret)
        const match = before.match(/(^|\s)([@/#])([\w-]*)$/)
        const trigger = match && triggers.includes(match[2] as MentionTrigger) ? (match[2] as MentionTrigger) : null
        setMention(match && trigger ? { trigger, query: match[3], start: caret - match[3].length - 1 } : null)
        if (trigger === '#') onComputersWanted?.()
        setHighlight(0)
    }, [onComputersWanted, triggers])

    const pick = useCallback(
        (item: MentionItem) => {
            const el = inputRef.current
            if (!el || !mention) return
            const caret = el.selectionStart ?? 0
            const inserted = `${mentionText(item)} `
            el.value = el.value.slice(0, mention.start) + inserted + el.value.slice(caret)
            const position = mention.start + inserted.length
            el.setSelectionRange(position, position)
            el.focus()
            setMention(null)
            onValueChange?.(el.value)
        },
        [mention, onValueChange]
    )

    const insertTrigger = useCallback(
        (trigger: MentionTrigger) => {
            const el = inputRef.current
            if (!el) return
            const caret = el.selectionStart ?? el.value.length
            const before = el.value.slice(0, caret)
            const inserted = before.length === 0 || /\s$/.test(before) ? trigger : ` ${trigger}`
            el.value = before + inserted + el.value.slice(caret)
            const position = caret + inserted.length
            el.focus()
            el.setSelectionRange(position, position)
            detect(el)
            onValueChange?.(el.value)
        },
        [detect, onValueChange]
    )

    const onChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => detect(e.currentTarget), [detect])
    const onSelect = useCallback((e: SyntheticEvent<HTMLTextAreaElement>) => detect(e.currentTarget), [detect])

    const onKeyDown = useCallback(
        (e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (!open) return
            if (e.key === 'Escape') {
                e.preventDefault()
                dismissedAt.current = `${e.currentTarget.selectionStart ?? 0}:${e.currentTarget.value}`
                setMention(null)
                return
            }
            if (items.length === 0) return
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setHighlight(h => (h + 1) % items.length)
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHighlight(h => (h - 1 + items.length) % items.length)
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                pick(items[highlight])
            }
        },
        [open, items, highlight, pick]
    )

    const menu: ReactNode = open ? <MentionMenu trigger={mention.trigger} items={items} listRead={listRead} highlight={highlight} onHover={setHighlight} onPick={pick} /> : null
    const commands = useMemo<MentionCommands>(() => ({ triggers, onPick: insertTrigger }), [triggers, insertTrigger])

    return { inputRef, menu, tokens, commands, textareaProps: { onChange, onSelect, onKeyDown } }
}

function CommandGlyph({ trigger }: { trigger: MentionTrigger }) {
    return <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted font-mono text-sm text-foreground">{trigger}</span>
}

// The `@` of the composer's footer: its symbols, each with what it does, for whoever has not guessed
// them. Picking one types it, which opens its menu.
export function MentionCommandsButton({ commands: { triggers, onPick } }: { commands: MentionCommands }) {
    const t = useTranslations('chat.mentions')
    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <PromptInputButton aria-label={t('button')}>
                    <span className="font-mono text-base leading-none">@</span>
                </PromptInputButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-72" onCloseAutoFocus={e => e.preventDefault()}>
                {triggers.map(trigger => (
                    <DropdownMenuItem key={trigger} onSelect={() => onPick(trigger)} className="items-start gap-2.5 py-2">
                        <CommandGlyph trigger={trigger} />
                        <span className="min-w-0">
                            <span className="block text-sm text-foreground">{t(`${COMMAND_KEY[trigger]}.action`)}</span>
                            <span className="block text-xs text-muted-foreground">{t(`${COMMAND_KEY[trigger]}.description`)}</span>
                        </span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

type MentionMenuProps = {
    trigger: MentionTrigger
    items: MentionItem[]
    listRead: boolean
    highlight: number
    onHover: (index: number) => void
    onPick: (item: MentionItem) => void
}

function MentionMenu({ trigger, items, listRead, highlight, onHover, onPick }: MentionMenuProps) {
    const t = useTranslations('chat.mentions')
    const listRef = useRef<HTMLUListElement>(null)

    // The list scrolls on its own; scrollIntoView would drag the surrounding sheet along, so
    // keep the highlighted row visible by nudging the list's own scrollTop.
    useEffect(() => {
        const list = listRef.current
        const row = list?.children[highlight] as HTMLElement | undefined
        if (!list || !row) return
        if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
        else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
    }, [highlight])

    return (
        <div className="absolute bottom-full start-0 end-0 z-50 mb-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
            <div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
                <CommandGlyph trigger={trigger} />
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{trigger === '@' ? t('coworkers') : trigger === '#' ? t('computers') : t('skills')}</p>
                    <p className="truncate text-xs text-muted-foreground">{t(`${COMMAND_KEY[trigger]}.description`)}</p>
                </div>
            </div>
            {items.length === 0 ? (
                listRead && <p className="px-3 py-3 text-sm text-muted-foreground">{t(`${COMMAND_KEY[trigger]}.empty`)}</p>
            ) : (
                <ul ref={listRef} role="listbox" className="relative max-h-56 space-y-0.5 overflow-y-auto p-1">
                    {items.map((item, index) => (
                        <li key={item.kind === 'skill' ? item.slug : item.id}>
                            <button
                                type="button"
                                role="option"
                                aria-selected={index === highlight}
                                className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm', index === highlight && 'bg-accent text-accent-foreground', item.kind === 'computer' && item.status === 'offline' && 'text-muted-foreground')}
                                onMouseEnter={() => onHover(index)}
                                onMouseDown={e => {
                                    e.preventDefault()
                                    onPick(item)
                                }}
                            >
                                {item.kind === 'agent' && <AgentBuddy agentId={item.id} size={20} animated={false} facing="right" />}
                                {item.kind === 'computer' && <OsTile os={item.os} size="sm" />}
                                <span className="flex-1 min-w-0">
                                    <span className="block truncate">
                                        {item.name}
                                        {item.kind === 'skill' && <span className="ms-1.5 text-muted-foreground">/{item.slug}</span>}
                                    </span>
                                    {item.kind === 'agent' && item.handle && <span className="block truncate text-xs text-muted-foreground">@{item.handle}</span>}
                                    {item.kind === 'skill' && item.description && <span className="block truncate text-xs text-muted-foreground">{item.description}</span>}
                                    {item.kind === 'computer' && <ComputerHandle handle={item.handle} className="block truncate text-xs" />}
                                </span>
                                {item.kind === 'agent' && item.hint && <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{item.hint}</span>}
                                {item.kind === 'computer' && <ComputerStatusBadge status={item.status} />}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
