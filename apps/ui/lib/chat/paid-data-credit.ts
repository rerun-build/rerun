import { isPaidDataOutOfCredit, isPaidDataTool, stripBridgePrefix } from '@rerun/contracts'

type PartLike = { type: string; toolName?: string; output?: unknown }
type MessageLike = { role: string; parts: readonly PartLike[] }

const toolNameOf = (part: PartLike) => stripBridgePrefix(part.toolName ?? (part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : ''))

export function turnRanOutOfPaidCredit(messages: readonly MessageLike[]): boolean {
    for (let i = messages.length - 1; i >= 0 && messages[i].role !== 'user'; i--) {
        if (messages[i].parts.some(part => isPaidDataTool(toolNameOf(part)) && isPaidDataOutOfCredit(part.output))) return true
    }
    return false
}
