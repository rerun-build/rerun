import { describe, expect, it } from 'vitest'
import { parseScheduledRun } from '@rerun/contracts'
import { buildCheckinMessage } from './message.js'

const now = new Date('2026-11-19T08:30:00.000Z')

describe('buildCheckinMessage', () => {
    it('draws as a scheduled run, never as a message somebody typed', () => {
        const message = buildCheckinMessage({ slug: 'checkin', name: 'Check-in', reason: 'pulse', members: [], now })
        expect(parseScheduledRun(message)).toMatchObject({ slug: 'checkin', name: 'Check-in' })
        expect(message).toContain('Nobody has written in this workspace yet.')
    })

    it('says who the people are, the hour where they are and when they last wrote', () => {
        const message = buildCheckinMessage({
            slug: 'checkin',
            name: 'Check-in',
            reason: 'manual',
            now,
            members: [
                { id: 'u-ana', name: 'Ana', timezone: 'Europe/Paris', firstSeenAt: '2026-11-01T00:00:00.000Z', lastSeenAt: '2026-11-19T07:00:00.000Z' },
                { id: 'u-bo', name: null, timezone: null, firstSeenAt: '2026-11-01T00:00:00.000Z', lastSeenAt: '2026-11-18T07:00:00.000Z' },
                { id: 'u-cy', name: 'Cy', timezone: 'Asia/Tokyo', firstSeenAt: '2026-11-01T00:00:00.000Z', lastSeenAt: '2026-11-12T07:00:00.000Z' },
            ],
        })
        expect(message).toContain('someone asked you to check in now')
        expect(message).toContain('- Ana (id u-ana): it is Thursday 09:30 where they are (Europe/Paris), wrote today')
        expect(message).toContain('- A member (id u-bo): their time zone is not known, last wrote yesterday')
        expect(message).toContain('- Cy (id u-cy): it is Thursday 17:30 where they are (Asia/Tokyo), last wrote 7 days ago')
    })

    it('carries what a promise said it would come back to', () => {
        const message = buildCheckinMessage({ slug: 'invoices', name: 'Back on the invoices', reason: 'promise', members: [], promise: '  See whether Ana reconnected Stripe.  ', now })
        expect(message).toContain('a routine you set yourself to come back to something came due')
        expect(message).toContain('What you said you would come back to:\nSee whether Ana reconnected Stripe.')
    })

    it('lists what its latest check-ins already told someone, so it does not say it again', () => {
        const message = buildCheckinMessage({
            slug: 'checkin',
            name: 'Check-in',
            reason: 'pulse',
            now,
            members: [{ id: 'u-ana', name: 'Ana', timezone: 'Europe/Paris', firstSeenAt: '2026-11-01T00:00:00.000Z', lastSeenAt: '2026-11-19T07:00:00.000Z' }],
            reports: [
                { runId: 'r2', sessionId: 's2', status: 'done', startedAt: '2026-11-18T08:00:00.000Z', reason: 'pulse', title: 'Stripe needs to be signed in again', reportedTo: 'u-ana' },
                { runId: 'r1', sessionId: 's1', status: 'done', startedAt: '2026-11-16T08:00:00.000Z', reason: 'pulse', title: 'Invoices keep failing' },
            ],
        })
        expect(message).toContain('What your latest check-ins already told someone, the latest first:\n- yesterday, for Ana: Stripe needs to be signed in again\n- 3 days ago, for the owner: Invoices keep failing')
        expect(buildCheckinMessage({ slug: 'checkin', name: 'Check-in', reason: 'pulse', members: [], now })).not.toContain('already told someone')
    })
})
