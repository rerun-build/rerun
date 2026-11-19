import { hitlKindOf, PUSH_CATEGORIES, type PushCategory } from '@rerun/contracts'
import type { StoredNotification } from '@/lib/notifications/inbound'

export type PushButtons = { categoryId: PushCategory; toolCallId?: string }

// Only what can be answered from a lock screen gets buttons: a yes or no, or a line of text. A key,
// an app to connect, a computer to reach or a browser to take over always open the app.
const APPROVABLE = new Set(['approval', 'spend'])

function stringField(notification: StoredNotification, key: string): string | null {
    const value = notification.metadata?.[key]
    return typeof value === 'string' && value ? value : null
}

export function pushButtonsOf(notification: StoredNotification, conversationId: string | null): PushButtons | null {
    if (!conversationId) return null
    if (notification.kind === 'done') return { categoryId: PUSH_CATEGORIES.reply }

    const toolCallId = stringField(notification, 'toolCallId')
    const toolName = stringField(notification, 'toolName')
    if (notification.event !== 'agent.notification' || !toolCallId || !toolName) return null
    const hitl = hitlKindOf(toolName)
    if (hitl === 'question') return { categoryId: PUSH_CATEGORIES.question, toolCallId }
    if (hitl && APPROVABLE.has(hitl)) return { categoryId: PUSH_CATEGORIES.approval, toolCallId }
    return null
}
