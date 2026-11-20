import { describe, expect, it } from 'vitest'

import { parseTriggerTarget, triggerPath } from './trigger-path'

describe('triggerPath', () => {
    it('names a coworker by its row and the Chief of Staff by its workspace', () => {
        expect(triggerPath('a1', 7, 'new-lead', 'tok')).toBe('/api/t/a1/new-lead/tok')
        expect(triggerPath('foreman', 7, 'new-lead', 'tok')).toBe('/api/t/foreman.7/new-lead/tok')
    })

    it('reads back what it built, and nothing else as the Chief of Staff', () => {
        expect(parseTriggerTarget('foreman.7')).toEqual({ kind: 'foreman', workspaceId: 7 })
        expect(parseTriggerTarget('a1')).toEqual({ kind: 'agent', agentId: 'a1' })
        for (const segment of ['foreman', 'foreman.', 'foreman.0', 'foreman.7x', 'foreman.-1']) expect(parseTriggerTarget(segment)).toEqual({ kind: 'agent', agentId: segment })
    })
})
