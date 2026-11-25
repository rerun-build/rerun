import { describe, expect, it } from 'vitest'

import { incidentKeyFor, resolvedIncidentKeysFor } from './incidents'

const failedSchedule = { event: 'agent.schedule.completed', kind: 'error', agentId: 'agt_1', sessionId: 'ses_1', metadata: { scheduleSlug: 'weekly' } } as const

describe('incidentKeyFor', () => {
    it('keys a failing schedule by its slug, however many sessions its runs open', () => {
        expect(incidentKeyFor(failedSchedule)).toBe('agt_1:schedule:weekly')
        expect(incidentKeyFor({ ...failedSchedule, sessionId: 'ses_2' })).toBe('agt_1:schedule:weekly')
    })

    it('keys a question by its conversation', () => {
        expect(incidentKeyFor({ event: 'agent.notification', kind: 'question', agentId: 'agt_1', sessionId: 'ses_1' })).toBe('agt_1:session:ses_1')
    })
})

describe('resolvedIncidentKeysFor', () => {
    it('closes the schedule and the conversation a good run went through', () => {
        expect(resolvedIncidentKeysFor({ ...failedSchedule, kind: 'done' })).toEqual(['agt_1:schedule:weekly', 'agt_1:session:ses_1'])
    })

    it('closes only the conversation of a chat run', () => {
        expect(resolvedIncidentKeysFor({ event: 'agent.message.completed', kind: 'done', agentId: 'agt_1', sessionId: 'ses_1' })).toEqual(['agt_1:session:ses_1'])
    })
})
