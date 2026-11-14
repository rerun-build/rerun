import { generateId, type UIMessage } from 'ai'

import type { UnansweredReason } from '@/components/foreman/widgets/question-answer'

import { widgetName } from './pending-widget'

const SEALED: Record<string, unknown> = { open_checkout: { ok: false, reason: 'dismissed' }, open_template_purchase: { ok: false, reason: 'dismissed' } }

type ToolPart = { type: string; toolCallId?: string; state?: string; output?: unknown }

export function sealPendingWidgets(messages: UIMessage[], reason: UnansweredReason = 'abandoned'): UIMessage[] {
    let sealed = false

    const next = messages.map(message => {
        let touched = false
        const parts = message.parts.map(part => {
            const tool = part as ToolPart
            const name = widgetName(tool)
            if (!name || tool.state !== 'input-available') return part
            touched = true
            sealed = true
            return { ...part, state: 'output-available', output: SEALED[name] ?? { answered: false, reason } }
        })
        return touched ? { ...message, parts } : message
    })

    return sealed ? (next as UIMessage[]) : messages
}

export function withTypedAnswer(messages: UIMessage[], text: string): UIMessage[] {
    return [...sealPendingWidgets(messages, 'typed'), { id: generateId(), role: 'user', parts: [{ type: 'text', text }] }]
}
