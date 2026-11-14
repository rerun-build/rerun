'use client'

import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { TextShimmer } from '@rerun/ui'

import { Message, MessageContent } from '@/components/ai-elements/message'
import { DotSpinner } from '@/components/ui/dot-spinner'
import { TextLoop } from '@/components/ui/text-loop'
import { useToolDisplay } from '@/hooks/useToolDisplay'
import { LOADING_ACTIVITIES, liveActivityLabel } from '@/lib/agent-chat-loader'

type ChatActivityLoaderProps = {
    agentId?: string
    message?: Parameters<typeof liveActivityLabel>[0]
    indicator?: ReactNode
}

export function ChatActivityLoader({ agentId, message, indicator }: ChatActivityLoaderProps) {
    const t = useTranslations('chat.activity')
    const tSubRuns = useTranslations('subRuns')
    const toolDisplay = useToolDisplay(agentId)
    const activity = liveActivityLabel(message, { t, subRuns: tSubRuns, toolLabel: (toolName, input) => toolDisplay(toolName, input).label })

    return (
        <Message from="assistant">
            <MessageContent className="overflow-visible">
                <div className="flex h-8 items-center gap-2">
                    {indicator ?? <DotSpinner variant="light" size="xs" />}
                    {activity ? (
                        <TextShimmer className="text-sm">{activity}</TextShimmer>
                    ) : (
                        <TextLoop className="text-sm" interval={2.5}>
                            {LOADING_ACTIVITIES.map(loading => (
                                <TextShimmer key={loading}>{t(loading)}</TextShimmer>
                            ))}
                        </TextLoop>
                    )}
                </div>
            </MessageContent>
        </Message>
    )
}
