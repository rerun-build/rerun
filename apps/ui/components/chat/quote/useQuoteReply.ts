'use client'

import { QUOTE_FROM_USER, type MessageQuote } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import { findQuoteSource, isInkSource, paintQuoteMark, quotableTextOf, rangeOver } from '@/components/chat/quote/quote-source'

// Long enough to find the passage after the scroll, short enough not to linger.
const SOURCE_FLASH_MS = 1600

export type QuoteSide = 'user' | 'assistant'

type QuoteReply = {
    /** Quotes the whole of a bubble: its icon on hover, a swipe on a touch screen. */
    quoteBubble: (bubble: HTMLElement) => void
    /** Scrolls back to the passage a sent quote came from and marks it for a moment. */
    showSource: (quote: MessageQuote) => void
}

// What the bubbles of a chat reach to start a reply. Absent where nobody can reply (a read-only
// transcript, the Chief of Staff's thread): the bubbles then offer nothing.
export const QuoteReplyContext = createContext<QuoteReply | null>(null)

export const useQuoteReplyContext = () => useContext(QuoteReplyContext)

/** Who wrote a quoted passage, as the screen names them. */
export function useQuoteAuthor(): (quote: MessageQuote) => string {
    const t = useTranslations('chat.quote')
    return quote => (quote.from === QUOTE_FROM_USER ? t('you') : quote.from)
}

type DraftQuote = { value: MessageQuote; range: Range | null; onInk: boolean }

type UseQuoteReplyOptions = {
    rootRef: RefObject<HTMLElement | null>
    /** Who wrote the passage, as the coworker reads it: QUOTE_FROM_USER for the person who quotes it. */
    authorOf: (side: QuoteSide, messageId: string) => string
    focusComposer: () => void
    stopFollowing: () => void
    /** A quote belongs to one conversation: a new key drops it. */
    conversationKey: string | null | undefined
}

// The one quote a reply carries at a time: a new one replaces the last. While it waits in the
// composer, its passage stays marked in the source.
export function useQuoteReply({ rootRef, authorOf, focusComposer, stopFollowing, conversationKey }: UseQuoteReplyOptions) {
    const [draft, setDraft] = useState<DraftQuote | null>(null)
    const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const [lastKey, setLastKey] = useState(conversationKey)
    if (lastKey !== conversationKey) {
        setLastKey(conversationKey)
        setDraft(null)
    }

    useEffect(() => paintQuoteMark('draft', draft?.range ?? null, draft?.onInk), [draft])
    useEffect(
        () => () => {
            paintQuoteMark('draft', null)
            paintQuoteMark('flash', null)
            if (flashTimer.current) clearTimeout(flashTimer.current)
        },
        []
    )

    const quoteFrom = useCallback(
        (source: HTMLElement, text: string, range: Range | null) => {
            const row = source.closest<HTMLElement>('[data-message-id]')
            const messageId = row?.dataset.messageId
            if (!messageId || !text) return
            const onInk = isInkSource(source)
            setDraft({ value: { from: authorOf(onInk ? 'user' : 'assistant', messageId), messageId, text }, range, onInk })
            window.getSelection()?.removeAllRanges()
            requestAnimationFrame(focusComposer)
        },
        [authorOf, focusComposer]
    )

    const quoteBubble = useCallback(
        (bubble: HTMLElement) => {
            const source = bubble.matches('[data-quote-text]') ? bubble : bubble.querySelector<HTMLElement>('[data-quote-text]')
            if (source) quoteFrom(source, quotableTextOf(source.innerText), rangeOver(source))
        },
        [quoteFrom]
    )

    const showSource = useCallback(
        (quote: MessageQuote) => {
            const source = findQuoteSource(rootRef.current, quote)
            if (!source) return
            stopFollowing()
            source.bubble.scrollIntoView({ block: 'center', behavior: 'smooth' })
            paintQuoteMark('flash', source.range ?? rangeOver(source.bubble), isInkSource(source.bubble))
            if (flashTimer.current) clearTimeout(flashTimer.current)
            flashTimer.current = setTimeout(() => paintQuoteMark('flash', null), SOURCE_FLASH_MS)
        },
        [rootRef, stopFollowing]
    )

    const clear = useCallback(() => setDraft(null), [])
    const context = useMemo<QuoteReply>(() => ({ quoteBubble, showSource }), [quoteBubble, showSource])

    return { quote: draft?.value ?? null, quoteFrom, clear, showSource, context }
}
