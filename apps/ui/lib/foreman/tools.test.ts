import { describe, expect, it, vi } from 'vitest'

import type { ForemanState } from './phase'

vi.mock('server-only', () => ({}))
vi.mock('./onboarding-tools', () => ({ dispatchOnboardingTool: vi.fn() }))
vi.mock('./search-docs', () => ({ searchDocs: vi.fn() }))

const { foremanActiveTools } = await import('./tools')

function stateWith(patch: Partial<ForemanState>): ForemanState {
    return { phase: 'discover', intent: null, answers: {}, foreman: {}, onboardingCompletedAt: null, firstName: '', language: null, entitled: false, trialSpent: false, trialNeedsCard: false, priceArm: '49', client: 'web', workspaceName: 'Acme', workspacePlan: 'none', userEmail: null, spaces: [], agents: [], ...patch }
}

describe('foremanActiveTools', () => {
    it('hands the app no contact_team: it has no team chat to open', () => {
        expect(foremanActiveTools(stateWith({ client: 'web' }))).toContain('contact_team')
        for (const client of ['ios', 'android'] as const) {
            expect(foremanActiveTools(stateWith({ client }))).not.toContain('contact_team')
            expect(foremanActiveTools(stateWith({ client, phase: 'trial' }))).toEqual(['search_docs'])
        }
    })
})
