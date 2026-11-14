import type { UIMessage } from 'ai'

export const ARRIVAL_STEPS = ['account', 'phone', 'trial', 'purchase', 'installing'] as const
export type ArrivalStep = (typeof ARRIVAL_STEPS)[number]

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

export function arrivalStepOf({ isAnonymous, phonePending, messages }: { isAnonymous: boolean; phonePending: boolean; messages: UIMessage[] }): ArrivalStep {
    if (isAnonymous) return 'account'
    if (phonePending) return 'phone'
    const parts = messages.flatMap(message => message.parts as LoosePart[])
    if (parts.some(part => part.type === 'tool-build_team')) return 'installing'
    if (parts.some(part => part.type === 'tool-open_template_purchase')) return 'purchase'
    return 'trial'
}
