import { needsHuman, type SessionStatus } from '@rerun/contracts'
import type { SFSymbol } from 'expo-symbols'

export type ConversationState = 'needs-you' | 'running' | 'new' | 'earlier'

// `status` and `unseen` are absent for a hub older than them, and for the Foreman's tabs: such a
// conversation falls into Earlier.
type Stateful = { status?: SessionStatus; unseen?: boolean }

export function stateOf({ status, unseen }: Stateful): ConversationState {
    if (status && needsHuman(status)) return 'needs-you'
    if (status === 'working') return 'running'
    if (unseen) return 'new'
    return 'earlier'
}

export const CONVERSATION_SECTIONS = [{ state: 'needs-you' }, { state: 'running' }, { state: 'new' }] as const satisfies readonly { state: ConversationState }[]

export const WAITING_GLYPH: Partial<Record<SessionStatus, SFSymbol>> = {
    awaiting_question: 'questionmark.bubble.fill',
    awaiting_approval: 'checkmark.shield.fill',
    awaiting_connector: 'link',
    awaiting_ack: 'exclamationmark.bubble.fill',
    waiting_human: 'hand.raised.fill',
    error: 'exclamationmark.triangle.fill',
}

export function glyphOf(conversation: Stateful): SFSymbol | undefined {
    const state = stateOf(conversation)
    if (state === 'needs-you') return conversation.status && WAITING_GLYPH[conversation.status]
    if (state === 'running') return 'arrow.triangle.2.circlepath'
    if (state === 'new') return 'circle.fill'
    return undefined
}

// The sections that have a conversation, in the menu's order, and the rest, folded under Earlier.
export function conversationSections<T extends Stateful>(conversations: T[]) {
    const sections = CONVERSATION_SECTIONS.map(section => ({ ...section, conversations: conversations.filter(conversation => stateOf(conversation) === section.state) })).filter(section => section.conversations.length > 0)
    const earlier = conversations.filter(conversation => stateOf(conversation) === 'earlier')
    return { sections, earlier }
}
