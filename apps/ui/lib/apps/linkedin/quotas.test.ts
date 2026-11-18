import { describe, expect, it } from 'vitest'
import { isoWeekKey, quotaClaim, quotaLimits, quotaNotice, quotaPace } from './quotas'

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

describe('quotaNotice', () => {
    it('says nothing while the account is within its pace', () => {
        expect(quotaNotice('content_read', [100], {})).toBeNull()
        expect(quotaNotice('invitation', [25, 150], {})).toBeNull()
    })

    it('lets a read go past the pace, and offers paid data as the safer way', () => {
        const notice = quotaNotice('content_read', [101], {})!
        expect(notice).toContain('past its recommended post, comment and reaction read pace (101 today, 100 per day recommended)')
        expect(notice).toContain('This call went through.')
        expect(notice).toContain('offer it as the safer way')
        for (const action of ['profile_view', 'search_result'] as const) {
            expect(quotaNotice(action, [5000], {})).toContain('paid_data')
        }
    })

    it('lets a send go past the pace, with no paid data, and leaves the choice to the user', () => {
        for (const action of ['invitation', 'message', 'engagement', 'post', 'job_application'] as const) {
            const notice = quotaNotice(action, [1000, 1000], {})!
            expect(notice).toContain("Going on is the user's call")
            expect(notice).not.toContain('paid_data')
            expect(notice).not.toMatch(/do not retry|stop/i)
        }
    })

    it('names only the window that is past its pace', () => {
        const notice = quotaNotice('invitation', [3, 151], {})!
        expect(notice).toContain('151 this week, 150 per week recommended')
        expect(notice).not.toContain('per day recommended')
    })
})

describe('quotaPace', () => {
    it('gives the coworker the pace of the account before it reaches it', () => {
        expect(quotaPace('invitation', {})).toBe('Recommended invitation pace for this account: 25 per day, 150 per week.')
        expect(quotaPace('content_read', { LINKEDIN_QUOTA_CONTENT_READ_DAY: '250' })).toBe('Recommended post, comment and reaction read pace for this account: 250 per day.')
    })
})
