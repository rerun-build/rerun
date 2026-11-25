import { describe, expect, it } from 'vitest'

import { INTAKE_QUOTA, takeIntakeCall } from './anonymous-intake-quota'

describe('takeIntakeCall', () => {
    it('stops a visitor at the quota', () => {
        const workspaceId = 9_000_001
        for (let i = 0; i < INTAKE_QUOTA.decide; i += 1) expect(takeIntakeCall(workspaceId, 'decide')).toBe(true)
        expect(takeIntakeCall(workspaceId, 'decide')).toBe(false)
    })

    it('keeps visitors apart', () => {
        for (let i = 0; i < INTAKE_QUOTA.decide; i += 1) takeIntakeCall(9_000_002, 'decide')
        expect(takeIntakeCall(9_000_003, 'decide')).toBe(true)
    })
})
