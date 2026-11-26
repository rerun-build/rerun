'use client'

import { quotePreview, type MessageQuote } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { useQuoteAuthor, useQuoteReplyContext } from '@/components/chat/quote/useQuoteReply'
import { Button } from '@/components/ui/button'
import { Quote, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

// Clipped over the composer, the shape of the queued message: the passage the next message replies
// to, on one line. It keeps its last quote while it closes, so the line does not empty mid-way.
export function QuoteStrip({ quote, onRemove, onShowSource }: { quote: MessageQuote | null; onRemove: () => void; onShowSource: (quote: MessageQuote) => void }) {
    const t = useTranslations('chat.quote')
    const authorOf = useQuoteAuthor()
    const [last, setLast] = useState(quote)
    if (quote && quote !== last) setLast(quote)
    const shown = quote ?? last

    return (
        <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', quote ? '-mb-px grid-rows-[1fr]' : 'grid-rows-[0fr]')} aria-hidden={!quote || undefined}>
            <div className="overflow-hidden">
                <div className="mx-2 flex min-w-0 items-center gap-2 rounded-t-lg border-x border-t border-input bg-input/30 ps-2.5 pe-1.5 pt-1 pb-1.5">
                    <Quote className="size-3.5 shrink-0 text-brand" />
                    {shown && (
                        <button type="button" className="min-w-0 flex-1 truncate text-start text-xs text-muted-foreground hover:text-foreground" title={shown.text} aria-label={t('showSource')} onClick={() => onShowSource(shown)}>
                            <span className="font-medium text-foreground">{authorOf(shown)}</span> · {quotePreview(shown.text)}
                        </button>
                    )}
                    <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" aria-label={t('remove')} title={t('remove')} onClick={onRemove}>
                        <XIcon className="size-3.5" />
                    </Button>
                </div>
            </div>
        </div>
    )
}

// At the top of the person's bubble, the passage their message answers. A click leads back to it
// where the chat can reply; a read-only transcript only shows it.
export function QuoteInBubble({ quote }: { quote: MessageQuote }) {
    const t = useTranslations('chat.quote')
    const reply = useQuoteReplyContext()
    const authorOf = useQuoteAuthor()
    const body = (
        <>
            <span className="block font-medium">{authorOf(quote)}</span>
            <span className="line-clamp-2 opacity-90">{quotePreview(quote.text)}</span>
        </>
    )
    const card = 'block w-full rounded-lg border-s-2 border-bubble-ink/60 bg-bubble-ink/15 px-2 py-1 text-start text-xs whitespace-normal'
    if (!reply) return <div className={card}>{body}</div>
    return (
        <button type="button" title={t('showSource')} onClick={() => reply.showSource(quote)} className={cn(card, 'transition-colors hover:bg-bubble-ink/25')}>
            {body}
        </button>
    )
}
