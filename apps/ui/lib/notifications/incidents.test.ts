import { emailTranslator } from '@rerun/emails/i18n'
import { describe, expect, it } from 'vitest'

import { announcesRecovery, emailSourceLabel, incidentKeyFor, resolvedIncidentKeysFor } from './incidents'

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

describe('announcesRecovery', () => {
    it('emails the return of a schedule or a trigger, never of a conversation', () => {
        expect(announcesRecovery('agt_1:schedule:weekly')).toBe(true)
        expect(announcesRecovery('agt_1:trigger:lead')).toBe(true)
        expect(announcesRecovery('agt_1:session:ses_1')).toBe(false)
    })

    it('reads the key from the right, an agent id may hold a colon', () => {
        expect(emailSourceLabel('agt:1:schedule:weekly', emailTranslator('en'))).toBe('Schedule "weekly"')
    })

    it('names the source in the language of the email', () => {
        expect(emailSourceLabel('agt_1:trigger:run', emailTranslator('fr'))).toBe('Un déclencheur')
    })
})
