import { cutsCardTag } from './card-tag-stream.js'

export const CARD_TAG_NUDGE = 'Your message ended on a card written as a tag (such as <ask_user>), which is not a card: the user sees no question and nothing is waiting for their answer. The message itself is already delivered, do not write it again. Make now the tool call you meant, mcp__rerun__ask_user or the card tool you named, with the questions or actions you had in mind, and nothing else.'

type StopInput = { hook_event_name?: string; stop_hook_active?: boolean; last_assistant_message?: string }

export async function cardTagStopHook(...args: unknown[]): Promise<{ continue: true } | { decision: 'block'; reason: string }> {
    const input = (args[0] ?? {}) as StopInput
    if (input.hook_event_name === 'Stop' && !input.stop_hook_active && cutsCardTag(input.last_assistant_message ?? '')) {
        return { decision: 'block', reason: CARD_TAG_NUDGE }
    }
    return { continue: true }
}
