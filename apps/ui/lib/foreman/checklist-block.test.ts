import { describe, expect, it } from 'vitest'

import { NO_PROGRESS } from '@/lib/onboarding/getting-started'
import { checklistBlock } from './checklist-block'

describe('checklistBlock', () => {
    it('says how far the workspace got and names the one step to lead to next', () => {
        const block = checklistBlock({ ...NO_PROGRESS, first_agent: true, ai_provider: true })
        expect(block).toMatch(/2 of [56] steps of its checklist are done/)
        expect(block).toContain('The next step: invite a teammate: ask for the addresses with ask_user, then invite_members')
        expect(block).toContain('never the whole list')
        expect(block).toContain('checkIn set to true')
    })

    it('says nothing once the checklist is finished, hidden or never read', () => {
        expect(checklistBlock({ ...NO_PROGRESS, first_agent: true, ai_provider: true, invite: true, schedule: true, payment_method: true })).toBeNull()
        expect(checklistBlock(null)).toBeNull()
        expect(checklistBlock(undefined)).toBeNull()
    })
})
