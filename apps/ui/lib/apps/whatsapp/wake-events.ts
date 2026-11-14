export const WAKE_EVENTS = ['message_received'] as const

export type WakeEvent = (typeof WAKE_EVENTS)[number]

export const WAKE_EVENT_LABELS: Record<WakeEvent, string> = {
    message_received: 'A message arrives',
}
