import { isPaidDataOutOfCredit, isPaidDataTool, toolNameOf } from '@rerun/contracts'

type PartLike = { type: string; toolName?: string; output?: unknown }
type MessageLike = { role: string; parts: readonly PartLike[] }

export function turnRanOutOfPaidCredit(messages: readonly MessageLike[]): boolean {
    for (let i = messages.length - 1; i >= 0 && messages[i].role !== 'user'; i--) {
        if (messages[i].parts.some(part => isPaidDataTool(toolNameOf(part)) && isPaidDataOutOfCredit(part.output))) return true
    }
    return false
}
