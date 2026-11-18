import { describe, expect, it } from 'vitest'
import { quotaClaim, quotaLimits, quotaNotice } from './quotas'

describe('WhatsApp quotas', () => {
    it('holds new conversations far below messages', () => {
        expect(quotaClaim('new_conversation', new Date('2026-10-19T08:00:00Z'), {})).toEqual({ periods: ['2026-10-19'], maxes: [20] })
        expect(quotaClaim('message', new Date('2026-10-19T08:00:00Z'), {})).toEqual({ periods: ['2026-10-19'], maxes: [100] })
    })

    it('reads an override from its own env prefix', () => {
        expect(quotaLimits('new_conversation', { WHATSAPP_QUOTA_NEW_CONVERSATION_DAY: '30' })).toEqual([{ window: 'day', max: 30 }])
        expect(quotaLimits('new_conversation', { LINKEDIN_QUOTA_NEW_CONVERSATION_DAY: '30' })).toEqual([{ window: 'day', max: 20 }])
    })

    it('lets a message go past the pace and tells the coworker the risk of a ban', () => {
        expect(quotaNotice('new_conversation', [20], {})).toBeNull()
        const notice = quotaNotice('new_conversation', [21], {})!
        expect(notice).toContain('past its recommended new conversation pace (21 today, 20 per day recommended)')
        expect(notice).toContain('risk of WhatsApp banning the number')
        expect(notice).toContain("Going on is the user's call")
    })
})
