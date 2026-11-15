import { describe, expect, it } from 'vitest'

import type { NotificationKind } from '@/lib/engine/types'

import { DEFAULT_NOTIFICATION_PREFS, taskKey, type NotificationPrefs } from './prefs'
import { computeRecipients, deliveryFor, needsOwnerFollow, reasonFor, recipientReason, wantsIncidentEmail, wantsPush, wantsRecoveryEmail, type RoutedEvent } from './routing'

type Member = 'you' | 'maya' | 'tom' | 'sarah'
type Seen = 'sound' | 'toast' | 'inbox' | 'email' | 'none'

const MEMBERS: Member[] = ['you', 'maya', 'tom', 'sarah']

const PREFS: Record<Member, NotificationPrefs> = {
    you: DEFAULT_NOTIFICATION_PREFS,
    maya: { ...DEFAULT_NOTIFICATION_PREFS, coworkers: { 'blog-writer': { mode: 'default', follow: true } } },
    tom: { ...DEFAULT_NOTIFICATION_PREFS, coworkers: { 'weekly-report': { mode: 'default', follow: true } } },
    sarah: DEFAULT_NOTIFICATION_PREFS,
}

type DayEvent = { id: string; coworker: string; kind: NotificationKind; startedBy: Member | 'schedule'; sharedWith?: Member[]; away?: Member[] }

const DAY: [DayEvent, Record<Member, Seen>][] = [
    [{ id: 'e1', coworker: 'weekly-report', kind: 'error', startedBy: 'schedule', away: MEMBERS }, { you: 'none', maya: 'none', tom: 'email', sarah: 'none' }],
    [{ id: 'e11', coworker: 'blog-writer', kind: 'done', startedBy: 'schedule' }, { you: 'none', maya: 'toast', tom: 'none', sarah: 'none' }],
    [{ id: 'e2', coworker: 'blog-writer', kind: 'done', startedBy: 'maya' }, { you: 'none', maya: 'sound', tom: 'none', sarah: 'none' }],
    [{ id: 'e3', coworker: 'lead-scout', kind: 'question', startedBy: 'you' }, { you: 'sound', maya: 'none', tom: 'none', sarah: 'none' }],
    [{ id: 'e4', coworker: 'blog-writer', kind: 'done', startedBy: 'tom' }, { you: 'none', maya: 'none', tom: 'sound', sarah: 'none' }],
    [{ id: 'e5', coworker: 'inbox-triage', kind: 'info', startedBy: 'sarah', sharedWith: ['you'] }, { you: 'toast', maya: 'none', tom: 'none', sarah: 'toast' }],
    [{ id: 'e6', coworker: 'lead-scout', kind: 'done', startedBy: 'you', away: ['you'] }, { you: 'inbox', maya: 'none', tom: 'none', sarah: 'none' }],
    [{ id: 'e7', coworker: 'blog-writer', kind: 'question', startedBy: 'maya' }, { you: 'none', maya: 'sound', tom: 'none', sarah: 'none' }],
    [{ id: 'e12', coworker: 'lead-scout', kind: 'done', startedBy: 'you' }, { you: 'sound', maya: 'none', tom: 'none', sarah: 'none' }],
    [{ id: 'e8', coworker: 'weekly-report', kind: 'done', startedBy: 'schedule' }, { you: 'none', maya: 'none', tom: 'toast', sarah: 'none' }],
    [{ id: 'e9', coworker: 'inbox-triage', kind: 'error', startedBy: 'sarah' }, { you: 'none', maya: 'none', tom: 'none', sarah: 'sound' }],
    [{ id: 'e10', coworker: 'lead-scout', kind: 'question', startedBy: 'tom' }, { you: 'none', maya: 'none', tom: 'sound', sarah: 'none' }],
]

function routed(event: DayEvent): RoutedEvent {
    const scheduled = event.startedBy === 'schedule'
    return {
        agentId: event.coworker,
        kind: event.kind,
        source: scheduled ? 'schedule' : 'dashboard',
        authorId: scheduled ? null : event.startedBy,
        participantIds: scheduled ? [] : [event.startedBy, ...(event.sharedWith ?? [])],
    }
}

function seen(event: DayEvent, member: Member, prefs: unknown = PREFS[member]): Seen {
    const reason = reasonFor(routed(event), member, prefs)
    if (!reason) return 'none'
    if (event.away?.includes(member)) return wantsIncidentEmail(prefs, reason, event.kind, event.coworker) ? 'email' : 'inbox'
    const delivery = deliveryFor(prefs, reason, event.kind, event.coworker)
    return delivery === 'none' ? 'inbox' : delivery
}

describe('the team day of the lab', () => {
    for (const [event, expected] of DAY) {
        it(`${event.id}: ${event.coworker} ${event.kind} reaches each member as the lab drew it`, () => {
            expect(Object.fromEntries(MEMBERS.map(member => [member, seen(event, member)]))).toEqual(expected)
        })
    }

    it('stores one recipient per member it reaches, with why', () => {
        const [event] = DAY[5]
        expect(computeRecipients(routed(event), MEMBERS.map(id => ({ id, prefs: PREFS[id] })))).toEqual({ you: 'participant', sarah: 'mine' })
    })
})

describe('scope and coworker rules', () => {
    const [question] = DAY[3]
    const [scheduledDone] = DAY[9]

    it('everything reaches a run started by someone else, as a quiet toast', () => {
        const prefs = { ...DEFAULT_NOTIFICATION_PREFS, scope: 'everything' }
        expect(reasonFor(routed(question), 'maya', prefs)).toBe('everything')
        expect(seen(question, 'maya', prefs)).toBe('toast')
    })

    it('only when needed keeps the questions of my runs and leaves their end in the inbox', () => {
        const prefs = { ...DEFAULT_NOTIFICATION_PREFS, scope: 'needed' }
        expect(seen(question, 'you', prefs)).toBe('sound')
        expect(seen(DAY[8][0], 'you', prefs)).toBe('inbox')
    })

    it('nothing keeps my rows in the inbox and never announces them, even away', () => {
        const prefs = { ...DEFAULT_NOTIFICATION_PREFS, scope: 'nothing' }
        expect(reasonFor(routed(question), 'you', prefs)).toBe('mine')
        expect(seen(question, 'you', prefs)).toBe('inbox')
        expect(seen({ ...question, away: ['you'] }, 'you', prefs)).toBe('inbox')
    })

    it('a coworker set to all activity goes through nothing, for my runs and everyone else’s', () => {
        const allActivity = { ...DEFAULT_NOTIFICATION_PREFS, scope: 'nothing', coworkers: { 'lead-scout': { mode: 'everything' } } }
        expect(reasonFor(routed(question), 'maya', allActivity)).toBe('all_activity')
        expect(seen(question, 'maya', allActivity)).toBe('toast')
        expect(seen(question, 'you', allActivity)).toBe('sound')
    })

    it('a muted coworker never reaches, not even its author', () => {
        expect(seen(question, 'you', { ...DEFAULT_NOTIFICATION_PREFS, coworkers: { 'lead-scout': { mode: 'muted' } } })).toBe('none')
    })

    it('without sound, what would ring is a toast', () => {
        expect(seen(question, 'you', { ...DEFAULT_NOTIFICATION_PREFS, sound: false })).toBe('toast')
    })

    it('a run nobody started reaches the followers only', () => {
        expect(reasonFor(routed(scheduledDone), 'tom', PREFS.tom)).toBe('followed')
        expect(reasonFor(routed(scheduledDone), 'you', PREFS.you)).toBeNull()
    })
})

describe('Notify me on one scheduled task', () => {
    const [cron] = DAY[0]
    const event = { ...routed(cron), taskSlug: 'weekly-export' }
    const key = taskKey('weekly-report', 'schedule', 'weekly-export')

    it('reaches someone who does not follow the coworker', () => {
        expect(reasonFor(event, 'you', { ...DEFAULT_NOTIFICATION_PREFS, tasks: { [key]: true } })).toBe('followed')
    })

    it('silences the task for a follower, and for a coworker set to all activity', () => {
        expect(reasonFor(event, 'tom', { ...PREFS.tom, tasks: { [key]: false } })).toBeNull()
        expect(reasonFor(event, 'you', { ...DEFAULT_NOTIFICATION_PREFS, coworkers: { 'weekly-report': { mode: 'everything' } }, tasks: { [key]: false } })).toBeNull()
    })

    it('leaves the other tasks of the coworker to its follow', () => {
        expect(reasonFor({ ...event, taskSlug: 'kpi-snapshot' }, 'tom', { ...PREFS.tom, tasks: { [key]: false } })).toBe('followed')
    })

    it('counts as a decision: the owner fallback stays out', () => {
        expect(needsOwnerFollow(event, [{ id: 'you', prefs: { ...DEFAULT_NOTIFICATION_PREFS, tasks: { [key]: false } } }])).toBe(false)
    })
})

describe('needsOwnerFollow', () => {
    const [cron] = DAY[0]
    const nobodyDecided = MEMBERS.map(id => ({ id, prefs: DEFAULT_NOTIFICATION_PREFS }))

    it('hands a cron nobody follows to the owner', () => {
        expect(needsOwnerFollow(routed(cron), nobodyDecided)).toBe(true)
    })

    it('stays out once someone follows it, explicitly stopped, or muted the coworker', () => {
        expect(needsOwnerFollow(routed(cron), MEMBERS.map(id => ({ id, prefs: PREFS[id] })))).toBe(false)
        const stopped = [{ id: 'you', prefs: { ...DEFAULT_NOTIFICATION_PREFS, coworkers: { 'weekly-report': { mode: 'default', follow: false } } } }]
        expect(needsOwnerFollow(routed(cron), stopped)).toBe(false)
        const muted = [{ id: 'you', prefs: { ...DEFAULT_NOTIFICATION_PREFS, coworkers: { 'weekly-report': { mode: 'muted' } } } }]
        expect(needsOwnerFollow(routed(cron), muted)).toBe(false)
    })

    it('never applies to a run someone started', () => {
        expect(needsOwnerFollow(routed(DAY[3][0]), nobodyDecided)).toBe(false)
    })
})

describe('wantsRecoveryEmail', () => {
    it('tells whoever was emailed that it works again, unless they have since opted out', () => {
        expect(wantsRecoveryEmail(DEFAULT_NOTIFICATION_PREFS, 'weekly-report')).toBe(true)
        expect(wantsRecoveryEmail({ ...DEFAULT_NOTIFICATION_PREFS, email: false }, 'weekly-report')).toBe(false)
        expect(wantsRecoveryEmail({ ...DEFAULT_NOTIFICATION_PREFS, scope: 'nothing' }, 'weekly-report')).toBe(false)
        expect(wantsRecoveryEmail({ ...DEFAULT_NOTIFICATION_PREFS, coworkers: { 'weekly-report': { mode: 'muted' } } }, 'weekly-report')).toBe(false)
    })
})

describe('recipientReason', () => {
    it('lets a row stored before recipients existed reach everyone', () => {
        expect(recipientReason(null, 'you')).toBe('legacy')
    })

    it('keeps a row away from someone it does not name', () => {
        expect(recipientReason({ maya: 'mine' }, 'you')).toBeNull()
        expect(recipientReason({ you: 'followed' }, 'you')).toBe('followed')
    })
})

describe('wantsPush', () => {
    const prefs = (patch: Partial<NotificationPrefs>): NotificationPrefs => ({ ...DEFAULT_NOTIFICATION_PREFS, ...patch })

    it('rings for what the scope lets through, email off or not', () => {
        expect(wantsPush(prefs({ email: false }), 'mine', 'done', 'a1')).toBe(true)
        expect(wantsPush(prefs({ scope: 'needed' }), 'mine', 'question', 'a1')).toBe(true)
        expect(wantsPush(prefs({ scope: 'needed' }), 'mine', 'done', 'a1')).toBe(false)
        expect(wantsPush(prefs({ scope: 'nothing' }), 'participant', 'question', 'a1')).toBe(false)
    })

    it('lets a coworker set to all activity, and workspace news, through any scope', () => {
        expect(wantsPush(prefs({ scope: 'nothing', coworkers: { a1: { mode: 'everything' } } }), 'mine', 'done', 'a1')).toBe(true)
        expect(wantsPush(prefs({ scope: 'nothing' }), 'workspace', 'error', null)).toBe(true)
    })
})
