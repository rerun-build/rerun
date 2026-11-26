'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { quotableTextOf } from '@/components/chat/quote/quote-source'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { ReplyIcon } from '@/lib/icons'
import { isTypingTarget } from '@/lib/typing-target'

const QUOTE_KEY = 'r'
// Height of the pill and the gap to the selection: under the selection when there is no room above.
const PILL_ROOM = 44
const PILL_EDGE = 56

type PendingSelection = { source: HTMLElement; text: string; range: Range; top: number; bottom: number; left: number }

const elementOf = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)

// The text selected inside one message of the chat, the selection a reply can quote.
function quotableSelection(root: HTMLElement | null): { source: HTMLElement; range: Range; text: string } | null {
    const selection = window.getSelection()
    if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    const source = elementOf(range.startContainer)?.closest<HTMLElement>('[data-quote-text]')
    const row = source?.closest('[data-message-id]')
    if (!source || !row || !root.contains(row) || elementOf(range.endContainer)?.closest('[data-message-id]') !== row) return null
    const text = quotableTextOf(selection.toString())
    return text ? { source, range, text } : null
}

/** Whether R quotes the text selected in the chat rather than acting on a selected message. */
export function hasQuotableSelection(root: HTMLElement | null): boolean {
    return root?.dataset.quoteEnabled !== undefined && quotableSelection(root) !== null
}

type UseQuoteSelectionOptions = {
    rootRef: RefObject<HTMLElement | null>
    scroller: HTMLElement | null
    enabled: boolean
    onQuote: (source: HTMLElement, text: string, range: Range) => void
}

// Text selected inside one message of the chat, with a mouse or the keyboard, brings a Reply button
// over it. The selection may run across the bubbles of that message, never into another one.
export function useQuoteSelection({ rootRef, scroller, enabled, onQuote }: UseQuoteSelectionOptions) {
    const [pending, setPendingState] = useState<PendingSelection | null>(null)
    const pendingRef = useRef<PendingSelection | null>(null)
    const setPending = useCallback((next: PendingSelection | null) => {
        pendingRef.current = next
        setPendingState(next)
    }, [])

    const read = useCallback(() => {
        const root = rootRef.current
        const selected = quotableSelection(root)
        if (!root || !selected) return setPending(null)
        const { source, range, text } = selected
        const rect = range.getBoundingClientRect()
        const box = root.getBoundingClientRect()
        const left = Math.min(Math.max(rect.left - box.left + rect.width / 2, PILL_EDGE), box.width - PILL_EDGE)
        setPending({ source, text, range: range.cloneRange(), top: rect.top - box.top, bottom: rect.bottom - box.top, left })
    }, [rootRef, setPending])

    const take = useCallback(() => {
        const current = pendingRef.current
        if (!current) return
        setPending(null)
        onQuote(current.source, current.text, current.range)
    }, [onQuote, setPending])

    useEffect(() => {
        if (!enabled) return
        const onRelease = () => requestAnimationFrame(read)
        const onSelectionChange = () => {
            if (window.getSelection()?.isCollapsed) setPending(null)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (!pendingRef.current || event.key.toLowerCase() !== QUOTE_KEY || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return
            event.preventDefault()
            take()
        }
        const onScroll = () => setPending(null)
        document.addEventListener('pointerup', onRelease)
        document.addEventListener('keyup', onRelease)
        document.addEventListener('selectionchange', onSelectionChange)
        window.addEventListener('keydown', onKeyDown)
        scroller?.addEventListener('scroll', onScroll, { passive: true })
        return () => {
            document.removeEventListener('pointerup', onRelease)
            document.removeEventListener('keyup', onRelease)
            document.removeEventListener('selectionchange', onSelectionChange)
            window.removeEventListener('keydown', onKeyDown)
            scroller?.removeEventListener('scroll', onScroll)
            setPending(null)
        }
    }, [enabled, read, take, scroller, setPending])

    return { pending: enabled ? pending : null, take }
}

// Over the selection, under it when the top of the chat leaves no room.
export function QuoteSelectionPill({ pending, onReply }: { pending: { top: number; bottom: number; left: number }; onReply: () => void }) {
    const t = useTranslations('chat.quote')
    const below = pending.top < PILL_ROOM
    return (
        <div data-message-actions="" className="absolute z-20 -translate-x-1/2 animate-in fade-in zoom-in-95" style={{ left: pending.left, top: below ? pending.bottom + 8 : pending.top - 40 }} onPointerDown={event => event.preventDefault()}>
            <div className="flex items-center rounded-lg border border-border bg-popover p-0.5 shadow-md">
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" aria-keyshortcuts="R" onClick={onReply}>
                    <ReplyIcon className="size-3.5" />
                    {t('reply')}
                    <Kbd className="min-w-5 px-1 py-0 font-mono text-[10px] shadow-none">R</Kbd>
                </Button>
            </div>
        </div>
    )
}
