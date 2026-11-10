import type { InboxItem, InboxStatus } from '@rerun/contracts'

import type { CoworkerStatus } from '@/mocks/data'

export type InboxSectionKey = 'needsYou' | 'headsUps' | 'errors' | 'done'

export type InboxSection = { key: InboxSectionKey; items: InboxItem[] }

// The web's sections, in its order.
const SECTIONS: { key: InboxSectionKey; statuses: InboxStatus[] }[] = [
    { key: 'needsYou', statuses: ['awaiting_question', 'awaiting_approval', 'awaiting_connector', 'waiting_human'] },
    { key: 'headsUps', statuses: ['awaiting_ack'] },
    { key: 'errors', statuses: ['error'] },
    { key: 'done', statuses: ['done'] },
]

export function inboxSections(items: InboxItem[]): InboxSection[] {
    return SECTIONS.map(section => ({ key: section.key, items: items.filter(item => section.statuses.includes(item.status)) })).filter(section => section.items.length > 0)
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
