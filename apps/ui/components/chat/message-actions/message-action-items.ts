import type { ComponentType } from 'react'

import { CopyIcon, LinkIcon, PencilIcon, RefreshCcwIcon, Trash2Icon } from '@/lib/icons'
import type { MessageAction } from '@/lib/chat/message-actions'

export type MessageActionItem = {
    action: MessageAction
    icon: ComponentType<{ className?: string }>
    // Why the action is off, said in its tooltip. Absent, it runs.
    disabledReason?: string
}

export type MessageActionAvailability = { isUser: boolean; editBlockedReason?: string; changeBlockedReason?: string }

// The same actions, in the same order, in the bar under a selected message and in its menu.
export function messageActionItems({ isUser, editBlockedReason, changeBlockedReason }: MessageActionAvailability): MessageActionItem[] {
    return [
        isUser ? { action: 'edit', icon: PencilIcon, disabledReason: changeBlockedReason ?? editBlockedReason } : { action: 'regenerate', icon: RefreshCcwIcon, disabledReason: changeBlockedReason },
        { action: 'copy', icon: CopyIcon },
        { action: 'link', icon: LinkIcon },
        { action: 'delete', icon: Trash2Icon, disabledReason: changeBlockedReason },
    ]
}
