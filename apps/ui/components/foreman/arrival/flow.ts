import type { UIMessage } from 'ai'

// Someone who arrived on a template or on a shared coworker goes through the column instead of the
// welcome card: an account, a phone number, the trial, the template's own price when it has one, then
// the install, which asks nothing of them.

export const ARRIVAL_STEPS = ['account', 'phone', 'trial', 'purchase', 'installing'] as const
export type ArrivalStep = (typeof ARRIVAL_STEPS)[number]

// What the visitor counts: the phone number belongs to the account, and a free template has no
// price of its own to pay.
export type ArrivalGesture = 'account' | 'trial' | 'template' | 'installed'

export function arrivalGestures(paid: boolean): ArrivalGesture[] {
    return paid ? ['account', 'trial', 'template', 'installed'] : ['account', 'trial', 'installed']
}

export function gestureIndex(step: ArrivalStep, paid: boolean): number {
    if (step === 'account' || step === 'phone') return 0
    if (step === 'trial') return 1
    if (step === 'purchase') return 2
    return paid ? 3 : 2
}

type LoosePart = { type: string }

/** Read off the session and the conversation, so a reload or the way back from Google lands on the right step. */
export function arrivalStepOf({ isAnonymous, phonePending, messages }: { isAnonymous: boolean; phonePending: boolean; messages: UIMessage[] }): ArrivalStep {
    if (isAnonymous) return 'account'
    if (phonePending) return 'phone'
    const parts = messages.flatMap(message => message.parts as LoosePart[])
    if (parts.some(part => part.type === 'tool-build_team')) return 'installing'
    if (parts.some(part => part.type === 'tool-open_template_purchase')) return 'purchase'
    return 'trial'
}
