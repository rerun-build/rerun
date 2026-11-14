import type { Coworker, Session } from '@/mocks/data'

export type StatusLine = { text: string; tone: 'default' | 'muted' | 'waiting' | 'destructive' }

export function statusLine(coworker: Coworker, latest: Session | undefined): StatusLine {
    if (coworker.status === 'waiting_human' && latest?.pendingQuestion) return { text: latest.pendingQuestion, tone: 'waiting' }
    if (coworker.status === 'working') return { text: `Working · ${latest?.title ?? coworker.role}`, tone: 'muted' }
    if (coworker.status === 'error') return { text: 'Something went wrong', tone: 'destructive' }
    if (coworker.status === 'offline') return { text: `Asleep · ${coworker.role}`, tone: 'muted' }
    const last = latest?.messages.at(-1)
    if (last) return { text: last.text.replace(/\*\*/g, '').replace(/^- /gm, '').replace(/\s+/g, ' '), tone: 'muted' }
    return { text: coworker.role, tone: 'muted' }
}
