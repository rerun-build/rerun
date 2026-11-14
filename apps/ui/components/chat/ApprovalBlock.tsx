'use client'

import { MessageResponse } from '@/components/ai-elements/message'
import { ApprovalBlock as ApprovalPrompt } from '@rerun/ui/chat'
import { useToolDisplay } from '@/hooks/useToolDisplay'
import type { ApprovalChoice } from '@/lib/engine/types'
import { useCallback, useState } from 'react'

type ApprovalBlockProps = {
    toolName: string
    input?: unknown
    runId?: string
    agentId?: string
}

const renderMarkdown = (text: string) => <MessageResponse>{text}</MessageResponse>

export function ApprovalBlock({ toolName, input, runId, agentId }: ApprovalBlockProps) {
    const [responded, setResponded] = useState<ApprovalChoice | null>(null)
    const [loading, setLoading] = useState(false)
    const { label, iconProps } = useToolDisplay(agentId)(toolName)

    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : undefined
    const message = args?.message as string | undefined

    const handleChoice = useCallback(async (choice: ApprovalChoice) => {
        setLoading(true)
        try {
            await fetch('/api/chat/approval', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ runId, agentId, choice }),
            })
            setResponded(choice)
        } catch {
            setLoading(false)
        }
    }, [runId, agentId])

    return (
        <ApprovalPrompt
            label={label}
            {...(iconProps.src ? { iconSrc: iconProps.src } : { icon: iconProps.icon })}
            message={message}
            preview={typeof args?.preview === 'string' ? args.preview : undefined}
            responded={responded}
            loading={loading}
            onChoose={handleChoice}
            renderText={renderMarkdown}
        />
    )
}
