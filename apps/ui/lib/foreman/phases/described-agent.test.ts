import { describe, expect, it } from 'vitest'

import type { ArrivingIntent, ForemanState } from '../phase'
import { PLAN_PHASE } from './plan'

function stateWith(intent: ArrivingIntent | null): ForemanState {
    return {
        phase: 'plan',
        intent,
        answers: { company_name: 'Retalk', industry: 'saas' },
        foreman: { useCases: ['Finding leads'] },
        onboardingCompletedAt: null,
        firstName: 'Ada',
        language: 'en',
        entitled: false,
        trialSpent: false,
        trialNeedsCard: true,
        client: 'web',
        workspaceName: 'Retalk',
        workspacePlan: 'none',
        userEmail: null,
        spaces: [],
        agents: [],
    }
}

const DESCRIBED: ArrivingIntent = { kind: 'prompt', text: 'Find me leads every Monday', name: 'Lead Finder', description: 'Find me leads every Monday' }

describe('an agent described on the website', () => {
    it('keeps the name it carried on the website', () => {
        const plan = PLAN_PHASE.instructions(stateWith(DESCRIBED))
        expect(plan).toContain('Name it "Lead Finder" on the card')
        expect(plan).not.toContain('Name it after')
    })

    it('is named by the foreman when the website gave it no name', () => {
        const plan = PLAN_PHASE.instructions(stateWith({ kind: 'prompt', text: 'Find me leads' }))
        expect(plan).not.toContain('on the card, the name it already carried')
        expect(plan).toContain('Name it after its job')
    })
})

describe('an arrival with nothing described', () => {
    it('gets a name from the foreman', () => {
        expect(PLAN_PHASE.instructions(stateWith(null))).toContain('Name it after its job')
    })
})
