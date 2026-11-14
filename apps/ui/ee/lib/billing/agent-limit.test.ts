import { describe, expect, it } from 'vitest'
import { activeAgentLimitFor, TRIAL_ACTIVE_AGENTS } from './agent-limit'

const PLAN_AGENTS = 5

describe('activeAgentLimitFor', () => {
    it('runs a trial on the cap the webhook wrote', () => {
        expect(activeAgentLimitFor(TRIAL_ACTIVE_AGENTS, 'trialing')).toBe(TRIAL_ACTIVE_AGENTS)
    })

    it('honours a trial widened by hand in the admin', () => {
        expect(activeAgentLimitFor(9, 'trialing')).toBe(9)
    })

    it('hands a paying workspace everything it bought', () => {
        expect(activeAgentLimitFor(PLAN_AGENTS, 'active')).toBe(PLAN_AGENTS)
        expect(activeAgentLimitFor(9, 'active')).toBe(9)
    })

    it('leaves a late renewal alone', () => {
        expect(activeAgentLimitFor(PLAN_AGENTS, 'past_due')).toBe(PLAN_AGENTS)
    })

    it('runs nothing without a live subscription', () => {
        expect(activeAgentLimitFor(PLAN_AGENTS, null)).toBe(0)
        expect(activeAgentLimitFor(PLAN_AGENTS, 'canceled')).toBe(0)
        expect(activeAgentLimitFor(PLAN_AGENTS, 'trial_expired')).toBe(0)
    })

    it('keeps a sandbox unlimited', () => {
        expect(activeAgentLimitFor(null, 'active')).toBeNull()
    })

    it('keeps a trial narrowed below the cap', () => {
        expect(activeAgentLimitFor(0, 'trialing')).toBe(0)
    })
})
