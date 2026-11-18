'use client'

import type { RemoteOs } from '@rerun/contracts'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { ComputerHandle, ComputerStatusBadge, OsTile } from '@/components/computers/ComputerBits'
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

type Trigger = '@' | '/' | '#'

type MentionItem = ({ kind: 'agent' } & MentionAgent) | ({ kind: 'skill' } & MentionSkill) | ({ kind: 'computer' } & MentionComputer)

type MentionState = { trigger: Trigger; query: string; start: number }

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

const NO_COMPUTERS: MentionComputer[] = []

export function useMentionAutocomplete(agents: MentionAgent[], skills: MentionSkill[] = [], onValueChange?: (text: string) => void, computers: MentionComputer[] = NO_COMPUTERS, onComputersWanted?: () => void) {
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const [mention, setMention] = useState<MentionState | null>(null)
    const [highlight, setHighlight] = useState(0)

    const items = useMemo<MentionItem[]>(() => {
        if (!mention) return []
        const query = mention.query.toLowerCase()
        if (mention.trigger === '#')
            return computers
                .filter(c => c.name.toLowerCase().includes(query) || c.handle.includes(query))
                .map(c => ({ kind: 'computer' as const, ...c }))
                .sort((a, b) => Number(a.status === 'offline') - Number(b.status === 'offline') || a.name.localeCompare(b.name))
        if (mention.trigger === '/')
            return skills
                .filter(s => s.name.toLowerCase().includes(query) || s.slug.toLowerCase().includes(query))
                .map(s => ({ kind: 'skill' as const, ...s }))
                .sort((a, b) => a.name.localeCompare(b.name))
        return agents
            .filter(a => [a.name, a.handle ?? '', a.hint ?? ''].some(field => field.toLowerCase().includes(query)))
            .map(a => ({ kind: 'agent' as const, ...a }))
            .sort((a, b) => Number(b.preferred ?? false) - Number(a.preferred ?? false) || a.name.localeCompare(b.name))
    }, [agents, skills, computers, mention])

    const tokens = useMemo(() => mentionTokensOf(agents, skills, computers), [agents, skills, computers])

    const open = mention !== null && items.length > 0

    const detect = useCallback((el: HTMLTextAreaElement) => {
        const caret = el.selectionStart ?? 0
        const before = el.value.slice(0, caret)
        const match = before.match(/(^|\s)([@/#])([\w-]*)$/)
        setMention(match ? { trigger: match[2] as Trigger, query: match[3], start: caret - match[3].length - 1 } : null)
        if (match?.[2] === '#') onComputersWanted?.()
        setHighlight(0)
    }, [onComputersWanted])

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

    const onChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => detect(e.currentTarget), [detect])
    const onSelect = useCallback((e: SyntheticEvent<HTMLTextAreaElement>) => detect(e.currentTarget), [detect])

    const onKeyDown = useCallback(
        (e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (!open) return
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setHighlight(h => (h + 1) % items.length)
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHighlight(h => (h - 1 + items.length) % items.length)
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                pick(items[highlight])
            } else if (e.key === 'Escape') {
                e.preventDefault()
                setMention(null)
            }
        },
        [open, items, highlight, pick]
    )

    const menu: ReactNode = open ? <MentionMenu trigger={mention.trigger} items={items} highlight={highlight} onHover={setHighlight} onPick={pick} /> : null

    return { inputRef, menu, tokens, textareaProps: { onChange, onSelect, onKeyDown } }
}

type MentionMenuProps = {
    trigger: Trigger
    items: MentionItem[]
    highlight: number
    onHover: (index: number) => void
    onPick: (item: MentionItem) => void
}

function MentionMenu({ trigger, items, highlight, onHover, onPick }: MentionMenuProps) {
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
        <div className="absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
            <p className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{trigger === '@' ? t('coworkers') : trigger === '#' ? t('computers') : t('skills')}</p>
            <ul ref={listRef} role="listbox" className="relative max-h-56 space-y-0.5 overflow-y-auto p-1">
                {items.map((item, index) => (
                    <li key={item.kind === 'skill' ? item.slug : item.id}>
                        <button
                            type="button"
                            role="option"
                            aria-selected={index === highlight}
                            className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm', index === highlight && 'bg-accent text-accent-foreground', item.kind === 'computer' && item.status === 'offline' && 'text-muted-foreground')}
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
                                    {item.kind === 'skill' && <span className="ml-1.5 text-muted-foreground">/{item.slug}</span>}
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
        </div>
    )
}
