import { describe, expect, it } from 'vitest'
import { starterOf } from './run-starter.js'

describe('starterOf', () => {
    it('names the person who wrote in the chat', () => {
        expect(starterOf({ source: 'chat', author: { id: 'user-1', name: 'Noa' } })).toEqual({ kind: 'person', id: 'user-1' })
    })

    it('names the calling coworker before the person behind it', () => {
        expect(starterOf({ source: 'chat', author: { id: 'user-1' }, calledBy: { id: 'agent-2', name: 'Atlas', waiting: true } })).toEqual({ kind: 'coworker', id: 'agent-2' })
    })

    it('charges a chat with no author to nobody', () => {
        expect(starterOf({ source: 'chat' })).toEqual({ kind: 'api', id: null })
    })

    it('keeps the slug of a schedule, a webhook and a check-in', () => {
        expect(starterOf({ source: 'schedule', slug: 'daily-report', name: 'Daily report' })).toEqual({ kind: 'schedule', id: 'daily-report' })
        expect(starterOf({ source: 'trigger', slug: 'new-lead', name: 'New lead' })).toEqual({ kind: 'webhook', id: 'new-lead' })
        expect(starterOf({ source: 'checkin', slug: 'morning', name: 'Morning', reason: 'pulse' })).toEqual({ kind: 'checkin', id: 'morning' })
    })

    it('keeps the computer of a job', () => {
        expect(starterOf({ source: 'job', computer: 'laptop', jobId: 'job-1' })).toEqual({ kind: 'job', id: 'laptop' })
    })
})
