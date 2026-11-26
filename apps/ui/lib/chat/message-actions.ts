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

// What a press may land on without letting go of the selected message: its bar, an open menu (the
// right click), a popover, the confirmation of a deletion (a dialog the chat is not inside: the chat
// of a sheet sits in one), or a message of this chat. That message's own click moves the selection:
// letting go first would close the bar, lift the thread and drop the click beside it.
export function keepsMessageSelection(target: Element, chatRoot: HTMLElement | null): boolean {
    if (target.closest('[data-message-actions], [role="menu"], [data-radix-popper-content-wrapper]')) return true
    const dialog = target.closest('[role="dialog"], [role="alertdialog"]')
    if (dialog && !(chatRoot && dialog.contains(chatRoot))) return true
    const row = target.closest('[data-message-id]')
    if (row && chatRoot?.contains(row)) return true
    // A press while a menu is open only closes the menu.
    return !!target.ownerDocument.querySelector('[role="menu"]')
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
