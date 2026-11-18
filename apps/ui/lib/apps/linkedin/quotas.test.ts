import { describe, expect, it } from 'vitest'
import { isoWeekKey, quotaClaim, quotaLimits, quotaRefusal } from './quotas'

describe('isoWeekKey', () => {
    it('numbers weeks from Monday, ISO style', () => {
        expect(isoWeekKey(new Date('2026-10-14T12:00:00Z'))).toBe('2026-W42')
        expect(isoWeekKey(new Date('2026-10-12T00:00:00Z'))).toBe('2026-W42')
        expect(isoWeekKey(new Date('2026-10-11T23:59:59Z'))).toBe('2026-W41')
        expect(isoWeekKey(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53')
    })
})

describe('quotaClaim', () => {
    it('claims an invitation against its day and its week', () => {
        expect(quotaClaim('invitation', new Date('2026-10-14T08:00:00Z'), {})).toEqual({ periods: ['2026-10-14', '2026-W42'], maxes: [25, 150] })
    })

    it('reads an override from the env', () => {
        expect(quotaLimits('message', { LINKEDIN_QUOTA_MESSAGE_DAY: '60' })).toEqual([{ window: 'day', max: 60 }])
        expect(quotaLimits('message', { LINKEDIN_QUOTA_MESSAGE_DAY: 'lots' })).toEqual([{ window: 'day', max: 40 }])
    })

    it('claims a read of posts, comments or reactions against the 100 calls of the day', () => {
        expect(quotaClaim('content_read', new Date('2026-11-18T08:00:00Z'), {})).toEqual({ periods: ['2026-11-18'], maxes: [100] })
    })
})

describe('quotaRefusal', () => {
    it('offers paid data for a read once the account has read its share of the day', () => {
        expect(quotaRefusal('content_read', {})).toContain('post, comment and reaction read limit of this LinkedIn account is reached (100 per day)')
        for (const action of ['profile_view', 'search_result', 'content_read'] as const) {
            expect(quotaRefusal(action, {})).toContain('If you have paid_data and it reads what the task still needs, offer it to the user and say why')
        }
    })

    it('holds anything sent from the account until tomorrow, with no paid data', () => {
        for (const action of ['invitation', 'message', 'engagement', 'post', 'job_application'] as const) {
            expect(quotaRefusal(action, {})).toContain('Do not retry today: tell the user and pick the work up again tomorrow.')
            expect(quotaRefusal(action, {})).not.toContain('paid_data')
        }
    })
})
