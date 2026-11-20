import { describe, expect, it } from 'vitest'
import { computeAgentStatus, type SessionEntry } from './types'

const session = (status: SessionEntry['status']): SessionEntry => ({ id: status, agentId: 'seo_chef', originAgentId: null, status })

describe('computeAgentStatus', () => {
    // The board loads live sessions only, which holds exactly as long as this stays true.
    it('scores an agent with no session like one whose sessions are all idle', () => {
        expect(computeAgentStatus([], true)).toBe('idle')
        expect(computeAgentStatus([session('idle'), session('idle')], true)).toBe('idle')
    })

    it('keeps the loudest session of the lot', () => {
        expect(computeAgentStatus([session('idle'), session('awaiting_question')], true)).toBe('waiting_human')
        expect(computeAgentStatus([session('idle'), session('awaiting_ack')], true)).toBe('waiting_human')
        expect(computeAgentStatus([session('awaiting_question'), session('working')], true)).toBe('working')
    })
})
