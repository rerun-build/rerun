'use client'

import { PageProperty } from '@/components/brain/BrainPageParts'
import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { boxOfItem, coworkerOfAuthor, type BrainBox, type BrainFiling } from '@/lib/brain/items'
import { brainAuthorLabel } from '@/lib/brain/labels'
import { BoxIcon, PlusIcon, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { BrainItemMetaPatch } from '@rerun/contracts'
import { BRAIN_TAGS_MAX, normalizeBrainTag } from '@rerun/contracts'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

const EVERYONE = 'everyone'

export function useBoxLabel() {
    const t = useTranslations('brain.filing')
    return (box: BrainBox | null) => (box ? box.name || t('untitledBox') : t('everyone'))
}

export function TagBadge({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
    const t = useTranslations('brain.filing')
    return (
        <Badge
            size="xs"
            tone="neutral"
            glow={false}
            fill="outline"
            trailing={
                onRemove && (
                    <button type="button" onClick={onRemove} aria-label={t('removeTag', { tag })} className="-mr-1 rounded-full p-0.5 hover:bg-foreground/10">
                        <XIcon className="size-2.5" />
                    </button>
                )
            }
        >
            #{tag}
        </Badge>
    )
}

// The tags of an item, removed one by one, added from the ones the Brain already uses or typed new.
export function BrainTagEditor({ tags, suggestions, onChange }: { tags: string[]; suggestions: string[]; onChange: (tags: string[]) => void }) {
    const t = useTranslations('brain.filing')
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState('')
    const triggerRef = useRef<HTMLButtonElement>(null)
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)

    const typed = normalizeBrainTag(draft)
    const offered = suggestions.filter(tag => !tags.includes(tag) && tag.includes(typed))
    const full = tags.length >= BRAIN_TAGS_MAX

    const add = (tag: string) => {
        const clean = normalizeBrainTag(tag)
        if (clean && !tags.includes(clean)) onChange([...tags, clean])
        setDraft('')
        setOpen(false)
    }

    return (
        <>
            {tags.map(tag => (
                <TagBadge key={tag} tag={tag} onRemove={() => onChange(tags.filter(other => other !== tag))} />
            ))}
            {!full && (
                <Popover
                    open={open}
                    onOpenChange={next => {
                        if (next) setPortalContainer(triggerRef.current?.closest<HTMLElement>('[data-slot="dialog-content"]') ?? null)
                        setOpen(next)
                        if (!next) setDraft('')
                    }}
                >
                    <PopoverTrigger asChild>
                        <Button ref={triggerRef} size="xs" variant="ghost" className="text-muted-foreground">
                            <PlusIcon />
                            {t('addTag')}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-56 p-0" container={portalContainer}>
                        <Command shouldFilter={false}>
                            <CommandInput value={draft} onValueChange={setDraft} placeholder={t('tagPlaceholder')} />
                            <CommandList>
                                <CommandGroup>
                                    {typed && !tags.includes(typed) && !offered.includes(typed) && (
                                        <CommandItem value={`new:${typed}`} onSelect={() => add(typed)}>
                                            <PlusIcon />
                                            {t('createTag', { tag: typed })}
                                        </CommandItem>
                                    )}
                                    {offered.slice(0, 8).map(tag => (
                                        <CommandItem key={tag} value={tag} onSelect={() => add(tag)}>
                                            #{tag}
                                        </CommandItem>
                                    ))}
                                    {!typed && offered.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('tagHint')}</p>}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>
            )}
        </>
    )
}

export function BrainBoxSelect({ value, boxes, onChange, className }: { value: string | null; boxes: BrainBox[]; onChange: (spaceId: string | null) => void; className?: string }) {
    const t = useTranslations('brain.filing')
    const boxLabel = useBoxLabel()
    const current = boxOfItem(value, boxes)
    return (
        <Select value={current?.id ?? EVERYONE} onValueChange={next => onChange(next === EVERYONE ? null : next)}>
            <SelectTrigger size="sm" className={className} aria-label={t('box')}>
                <SelectValue>
                    <span className="flex min-w-0 items-center gap-1.5">
                        <BoxIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{boxLabel(current)}</span>
                    </span>
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={EVERYONE}>{t('everyone')}</SelectItem>
                {boxes.map(box => (
                    <SelectItem key={box.id} value={box.id}>
                        <BoxIcon className="size-3.5 text-muted-foreground" />
                        {boxLabel(box)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

// Who put the item in the Brain: a coworker drawn as itself, a person, or the import from the website.
function BrainAddedBy({ author, filing }: { author: string | null; filing: BrainFiling }) {
    const t = useTranslations('brain')
    if (!author) return <span className="text-muted-foreground">{t('filing.unknownAuthor')}</span>
    const coworker = coworkerOfAuthor(author, filing.coworkers)
    if (!coworker) return <span className={cn('truncate', author === 'seed' ? 'text-muted-foreground' : 'text-foreground/80')}>{brainAuthorLabel(author, t)}</span>
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            <AgentBuddy agentId={coworker.id} size={20} animated={false} facing="right" />
            <span className="truncate text-foreground/80">{coworker.name}</span>
        </span>
    )
}

type FilingPropertiesProps = {
    spaceId: string | null
    tags: string[]
    author: string | null
    filing: BrainFiling
    suggestions: string[]
    onChange: (patch: BrainItemMetaPatch) => void
}

// The three properties every page and file of the Brain carries, above its own.
export function BrainFilingProperties({ spaceId, tags, author, filing, suggestions, onChange }: FilingPropertiesProps) {
    const t = useTranslations('brain.filing')
    return (
        <>
            <PageProperty label={t('box')}>
                <BrainBoxSelect
                    value={spaceId}
                    boxes={filing.boxes}
                    onChange={next => onChange({ spaceId: next })}
                    className="-ml-2 max-w-full border-transparent bg-transparent shadow-none hover:bg-accent dark:bg-transparent dark:hover:bg-accent"
                />
            </PageProperty>
            <PageProperty label={t('tags')}>
                <BrainTagEditor tags={tags} suggestions={suggestions} onChange={next => onChange({ tags: next })} />
            </PageProperty>
            <PageProperty label={t('addedBy')}>
                <BrainAddedBy author={author} filing={filing} />
            </PageProperty>
        </>
    )
}
