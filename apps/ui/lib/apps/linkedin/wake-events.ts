export const WAKE_EVENTS = ['message_received', 'accepted_invitation', 'invitation_received'] as const

export type WakeEvent = (typeof WAKE_EVENTS)[number]

export const WAKE_EVENT_LABELS: Record<WakeEvent, string> = {
    message_received: 'A message arrives',
    accepted_invitation: 'An invitation is accepted',
    invitation_received: 'An invitation is received',
}

export function isWakeEvent(value: string): value is WakeEvent {
    return (WAKE_EVENTS as readonly string[]).includes(value)
}
