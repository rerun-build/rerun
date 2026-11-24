import { NEEDS_YOU_STATUSES, needsYou, type InboxItem, type InboxStatus } from '@rerun/contracts'

import type { CoworkerStatus } from '@/mocks/data'

export type InboxSectionKey = 'needsYou' | 'headsUps' | 'errors' | 'done'

export type InboxSection = { key: InboxSectionKey; items: InboxItem[] }

// The web's sections, in its order.
const SECTIONS: { key: InboxSectionKey; statuses: readonly InboxStatus[] }[] = [
    { key: 'needsYou', statuses: NEEDS_YOU_STATUSES },
    { key: 'headsUps', statuses: ['awaiting_ack'] },
    { key: 'errors', statuses: ['error'] },
    { key: 'done', statuses: ['done'] },
]

export function inboxSections(items: InboxItem[]): InboxSection[] {
    return SECTIONS.map(section => ({ key: section.key, items: items.filter(item => section.statuses.includes(item.status)) })).filter(section => section.items.length > 0)
}

// What « Mark as read » takes off the list. The hub also puts aside the conversation of a finished run it
// marks: one that has since stopped on a request stays, or its request would leave with it.
export function splitInbox(items: InboxItem[]): { informative: InboxItem[]; requests: InboxItem[] } {
    const requests = items.filter(item => needsYou(item.status))
    const waiting = new Set(requests.flatMap(item => item.sessionIds))
    return { requests, informative: items.filter(item => !needsYou(item.status) && !item.sessionIds.some(id => waiting.has(id))) }
}

// What the bell counts: every run a row stands for, as the web's tab title does.
export function inboxCount(items: InboxItem[]): number {
    return items.reduce((sum, item) => sum + item.count, 0)
}

export function badgeLabel(count: number): string {
    return count > 99 ? '99+' : String(count)
}

export function moodOfInbox(status: InboxStatus): CoworkerStatus {
    if (status === 'error') return 'error'
    if (status === 'done') return 'idle'
    return 'waiting_human'
}
