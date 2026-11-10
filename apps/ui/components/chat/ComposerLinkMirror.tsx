'use client'

import { LINK_TOKEN_CLASS, MENTION_TOKEN_CLASSES } from '@/components/chat/composer-token-styles'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TextareaMirror } from '@/components/ui/textarea-mirror'
import type { ComposerMention, ComposerSegment, TextRange } from '@/lib/chat/composer-links'
import { ExternalLinkIcon, Link2OffIcon, LinkIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { type ReactNode, type Ref, useRef, useState } from 'react'

type TokenProps = {
    /** The run of the textarea the token covers: laid out transparent, it reserves the token's room. */
    text: string
    className: string
    children: ReactNode
}

// The visible token sits over the room the transparent text reserves, at the textarea's own size so no gap opens
// around it. Its tighter tracking pays back what the heavier weight widens, so it neither spills over nor falls short.
function Token({ text, className, children }: TokenProps) {
    return (
        <>
            <span className="text-transparent">{text}</span>
            <span className="absolute inset-0 flex justify-center whitespace-nowrap">
                <span className={cn('flex items-center gap-[0.3em] font-medium tracking-[-0.01em] transition-colors', className)}>{children}</span>
            </span>
        </>
    )
}

type MentionChipProps = {
    text: string
    kind: ComposerMention['kind']
}

function MentionChip({ text, kind }: MentionChipProps) {
    return (
        <span aria-hidden className="relative">
            <Token text={text} className={MENTION_TOKEN_CLASSES[kind]}>
                {text}
            </Token>
        </span>
    )
}

type LinkChipProps = {
    text: string
    url: string
    onUnlink: () => void
    /** Where the textarea's caret goes back once the menu closes: right after the chip. */
    onDone: () => void
}

function LinkChip({ text, url, onUnlink, onDone }: LinkChipProps) {
    const t = useTranslations('chat.composer.link')
    const [open, setOpen] = useState(false)
    const unlinkingRef = useRef(false)

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <span role="button" aria-label={url} className="group pointer-events-auto relative cursor-pointer">
                    <Token
                        text={text}
                        className={cn(LINK_TOKEN_CLASS, 'underline-offset-2 group-hover:underline group-data-[state=open]:underline')}
                    >
                        <LinkIcon className="size-[0.85em] shrink-0" />
                        {text.trim()}
                    </Token>
                </span>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-auto flex-row gap-0 rounded-md p-0.5"
                onOpenAutoFocus={e => e.preventDefault()}
                onCloseAutoFocus={e => {
                    e.preventDefault()
                    if (!unlinkingRef.current) onDone()
                }}
            >
                <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                        window.open(url, '_blank', 'noopener,noreferrer')
                        setOpen(false)
                    }}
                >
                    <ExternalLinkIcon />
                    {t('open')}
                </Button>
                <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                        unlinkingRef.current = true
                        onUnlink()
                    }}
                >
                    <Link2OffIcon />
                    {t('unlink')}
                </Button>
            </PopoverContent>
        </Popover>
    )
}

type ComposerLinkMirrorProps = {
    segments: ComposerSegment[]
    className: string
    ref: Ref<HTMLDivElement>
    onPlaceCaret: (offset: number) => void
    onUnlink: (range: TextRange, url: string) => void
}

export function ComposerLinkMirror({ segments, className, ref, onPlaceCaret, onUnlink }: ComposerLinkMirrorProps) {
    const ends = segments.reduce<number[]>((acc, segment) => [...acc, (acc.at(-1) ?? 0) + segment.text.length], [])
    return (
        <TextareaMirror ref={ref} className={className}>
            {segments.map((segment, index) => {
                const end = ends[index]
                const start = end - segment.text.length
                // Keyed by position: a chip whose menu is open must not hand that state to the link that slides into its place.
                const key = `${start}:${segment.kind}`
                if (segment.kind === 'text') {
                    return (
                        <span key={key} aria-hidden>
                            {segment.text}
                        </span>
                    )
                }
                if (segment.kind === 'mention') return <MentionChip key={key} text={segment.text} kind={segment.mention} />
                return <LinkChip key={key} text={segment.text} url={segment.url} onUnlink={() => onUnlink({ start, end }, segment.url)} onDone={() => onPlaceCaret(end)} />
            })}
        </TextareaMirror>
    )
}
