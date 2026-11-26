import { messageText, parseJobEnd } from '@rerun/contracts'

import { parseHitlReply } from '@/lib/chat-hitl'
import { parseInstallMessage } from '@/lib/chat/install-marker'
import { parseScheduledRun } from '@/lib/schedules/scheduled-run'
import { parseTriggerPayload } from '@/lib/triggers/trigger-payload'

export type MessageAction = 'edit' | 'regenerate' | 'copy' | 'link' | 'delete'

export const MESSAGE_ACTION_KEYS: Record<MessageAction, string> = { edit: 'E', regenerate: 'R', copy: 'C', link: 'L', delete: '⌫' }

type PartLike = { type: string; text?: string }
type MessageLike = { id: string; role: string; parts: readonly PartLike[] }

export function actionForKey(key: string): MessageAction | null {
    if (key === 'Backspace' || key === 'Delete') return 'delete'
    switch (key.toLowerCase()) {
        case 'e':
            return 'edit'
        case 'r':
            return 'regenerate'
        case 'c':
            return 'copy'
        case 'l':
            return 'link'
        default:
            return null
    }
}

// What the person wrote, or what the coworker answered in words. A divider (an install, a routine,
// a webhook, the end of a job), the receipt of a card, or a turn of tool calls alone is not a message
// anyone edits, copies or deletes on its own.
export function isSelectableMessage(message: MessageLike): boolean {
    const text = messageText(message)
    if (message.role === 'assistant') return text.length > 0
    if (message.role !== 'user') return false
    return !parseInstallMessage(text) && !parseHitlReply(text) && !parseScheduledRun(text) && !parseTriggerPayload(text) && !parseJobEnd(text)
}
