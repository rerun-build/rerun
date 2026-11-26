'use client'

import { AgentWorkspaceMessage } from '@/components/chat/AgentWorkspaceMessage'
import { AGENT_BUBBLE_SURFACE } from '@/components/chat/bubble-styles'
import { MessageTimeTooltip } from '@/components/chat/MessageTimeTooltip'
import { QuotableBubble } from '@/components/chat/quote/QuotableBubble'
import { type BubbleFrame, splitIntoBubbles } from '@/lib/chat/message-bubbles'
import { cn } from '@/lib/utils'
import { Fragment, useMemo } from 'react'

type MessageBubblesProps = {
    agentId?: string
    children: string
    isAnimating?: boolean
    // Shown on the first bubble only: the stack is one message.
    createdAt?: string
}

// The cap of a bubble's width sits on QuotableBubble's box, the one a swipe moves.
const FRAME_CLASSES: Record<BubbleFrame, string> = {
    bubble: `${AGENT_BUBBLE_SURFACE} px-3.5 py-2 [&_[data-streamdown=inline-code]]:bg-background/70!`,
    bare: 'w-full',
    media: 'max-w-[88%]',
}

/** An answer drawn as a stack of bubbles, one per beat, so a long reply reads as a few short messages. */
export function MessageBubbles({ agentId, children, isAnimating = false, createdAt }: MessageBubblesProps) {
    const bubbles = useMemo(() => splitIntoBubbles(children), [children])

    return (
        <div className="flex w-full flex-col items-start gap-1.5">
            {bubbles.map((bubble, i) => {
                const frame = (
                    <MessageTimeTooltip createdAt={i === 0 ? createdAt : undefined} side="right">
                        <div data-bubble-frame={bubble.frame} data-quote-text={bubble.frame === 'media' ? undefined : 'assistant'} className={cn('min-w-0', FRAME_CLASSES[bubble.frame])}>
                            <AgentWorkspaceMessage agentId={agentId} isAnimating={isAnimating && i === bubbles.length - 1}>
                                {bubble.markdown}
                            </AgentWorkspaceMessage>
                        </div>
                    </MessageTimeTooltip>
                )
                // Keyed by position: a stream only ever grows the last bubble or opens a new one after it.
                // A code block or a table keeps its full width and its own horizontal scroll: it is
                // quoted by selecting in it, without an icon or a swipe.
                if (bubble.frame !== 'bubble') return <Fragment key={i}>{frame}</Fragment>
                return (
                    <QuotableBubble key={i} side="assistant" bubbleClassName="max-w-[88%]">
                        {frame}
                    </QuotableBubble>
                )
            })}
        </div>
    )
}
