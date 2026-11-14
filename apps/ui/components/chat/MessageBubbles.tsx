'use client'

import { AgentWorkspaceMessage } from '@/components/chat/AgentWorkspaceMessage'
import { AGENT_BUBBLE_SURFACE } from '@/components/chat/bubble-styles'
import { MessageTimeTooltip } from '@/components/chat/MessageTimeTooltip'
import { type BubbleFrame, splitIntoBubbles } from '@/lib/chat/message-bubbles'
import { cn } from '@/lib/utils'
import { useMemo } from 'react'

type MessageBubblesProps = {
    agentId?: string
    children: string
    isAnimating?: boolean
    createdAt?: string
}

const FRAME_CLASSES: Record<BubbleFrame, string> = {
    bubble: `max-w-[88%] ${AGENT_BUBBLE_SURFACE} px-3.5 py-2 [&_[data-streamdown=inline-code]]:bg-background/70!`,
    bare: 'w-full',
    media: 'max-w-[88%]',
}

export function MessageBubbles({ agentId, children, isAnimating = false, createdAt }: MessageBubblesProps) {
    const bubbles = useMemo(() => splitIntoBubbles(children), [children])

    return (
        <div className="flex w-full flex-col items-start gap-1.5">
            {bubbles.map((bubble, i) => (
                <MessageTimeTooltip key={i} createdAt={i === 0 ? createdAt : undefined} side="right">
                    <div data-bubble-frame={bubble.frame} className={cn('min-w-0', FRAME_CLASSES[bubble.frame])}>
                        <AgentWorkspaceMessage agentId={agentId} isAnimating={isAnimating && i === bubbles.length - 1}>
                            {bubble.markdown}
                        </AgentWorkspaceMessage>
                    </div>
                </MessageTimeTooltip>
            ))}
        </div>
    )
}
