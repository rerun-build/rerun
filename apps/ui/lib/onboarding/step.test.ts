import { describe, expect, it } from 'vitest'

import { isLegacyWorkspace, onboardingStep, type OnboardingFacts } from './step'

const RELEASED = '2026-12-01T00:00:00Z'
const AFTER = '2026-12-02T10:00:00Z'
const BEFORE = '2026-11-20T10:00:00Z'
const AT = '2026-12-02T10:05:00Z'

const fresh: OnboardingFacts = {
    admin: true,
    sandbox: false,
    createdAt: AFTER,
    archived: false,
    onboardedAt: null,
    foreman: {},
    agentCount: 0,
    phonePending: false,
    entitled: false,
    hasEngine: false,
    poolHasRoom: true,
    cloud: true,
}

const step = (facts: Partial<OnboardingFacts>, releasedAt: string | null = RELEASED) => onboardingStep({ ...fresh, ...facts }, releasedAt)
const profiled = { profileAt: AT }
const invited = { profileAt: AT, inviteAt: AT }

describe('onboardingStep', () => {
    it.each<[string, Partial<OnboardingFacts>, string]>([
        ['a new workspace starts on the questions', {}, 'profile'],
        ['then the phone, on Rerun Cloud', { foreman: profiled, phonePending: true }, 'phone'],
        ['then the invitations', { foreman: profiled }, 'invite'],
        ['then the trial', { foreman: invited }, 'trial'],
        ['or the waiting list when the pool is full', { foreman: invited, poolHasRoom: false }, 'waitlist'],
        ['then the box is claimed once the trial runs', { foreman: invited, entitled: true }, 'claiming'],
        ['then the Chief of Staff takes over', { foreman: invited, entitled: true, hasEngine: true }, 'handoff'],
        ['and the team it builds closes the dialog', { foreman: { ...invited, firstRunAt: AT }, entitled: true, hasEngine: true, agentCount: 2 }, 'done'],
    ])('%s', (_name, facts, expected) => {
        expect(step(facts)).toBe(expected)
    })

    describe('guards', () => {
        it('never shows a member the dialog', () => {
            expect(step({ admin: false })).toBe('done')
        })

        it('never shows a sandbox the dialog', () => {
            expect(step({ sandbox: true })).toBe('done')
        })

        it('closes once a coworker is on the board, however it got there', () => {
            expect(step({ foreman: invited, agentCount: 1 })).toBe('done')
            expect(step({ foreman: { ...invited, firstRunAt: AT } })).toBe('done')
        })

        it('leaves a workspace whose survey was answered before the profile alone', () => {
            expect(step({ onboardedAt: AT })).toBe('done')
        })

        it('leaves a workspace created before the release with nothing written alone', () => {
            expect(step({ createdAt: BEFORE })).toBe('done')
        })

        it('shows nothing before the release', () => {
            expect(step({}, null)).toBe('done')
        })

        it('sends an archived workspace to its restore', () => {
            expect(step({ foreman: invited, archived: true })).toBe('restoring')
        })
    })

    describe('arrived on a link', () => {
        const template = { arrival: { kind: 'template' as const, ref: 'crm-pipeline', at: AT } }

        it('skips the questions and the invitations, not the phone nor the trial', () => {
            expect(step({ foreman: template, phonePending: true })).toBe('phone')
            expect(step({ foreman: template })).toBe('trial')
        })

        it('installs what it came for once the box is there', () => {
            expect(step({ foreman: template, entitled: true })).toBe('claiming')
            expect(step({ foreman: template, entitled: true, hasEngine: true })).toBe('installing')
        })

        it('hands over once, after the install', () => {
            const installed = { foreman: { ...template, firstRunAt: AT }, entitled: true, hasEngine: true, agentCount: 1 }
            expect(step(installed)).toBe('handoff')
            expect(step({ ...installed, foreman: { ...installed.foreman, handoffAt: AT } })).toBe('done')
        })

        it('walks a prompt through the whole dialog', () => {
            expect(step({ foreman: { arrival: { kind: 'prompt', ref: 'Answer my leads', at: AT } } })).toBe('profile')
        })
    })

    describe('self-hosted', () => {
        it('has no phone, no trial and no waiting list: the invitations lead to the box', () => {
            expect(step({ cloud: false, phonePending: true, foreman: profiled })).toBe('invite')
            expect(step({ cloud: false, foreman: invited, poolHasRoom: false })).toBe('claiming')
            expect(step({ cloud: false, foreman: invited, hasEngine: true })).toBe('handoff')
        })
    })

    // Where the workspaces still in the hub's onboarding land on the day of the release.
    describe('workspaces on their way at the release', () => {
        it.each<[string, Partial<OnboardingFacts>, string]>([
            ['profile written, no plan', { createdAt: BEFORE, foreman: profiled }, 'invite'],
            ['plan accepted, no subscription', { createdAt: BEFORE, foreman: { ...profiled, plan: { title: 'Team', items: [] } } }, 'invite'],
            ['subscribed, nothing built', { createdAt: BEFORE, foreman: { ...profiled, plan: { title: 'Team', items: [] } }, entitled: true }, 'claiming'],
            ['installed from a link with no profile yet, not subscribed', { createdAt: BEFORE, foreman: { installedFirst: true, plan: { title: 'Kit', items: [] } } }, 'trial'],
            ['installed from a link, built', { createdAt: BEFORE, foreman: { installedFirst: true, firstRunAt: AT }, agentCount: 1, hasEngine: true }, 'done'],
            ['still on the welcome card', { createdAt: BEFORE }, 'done'],
            ['companion', { createdAt: BEFORE, onboardedAt: AT, agentCount: 3, entitled: true, hasEngine: true }, 'done'],
        ])('%s', (_name, facts, expected) => {
            expect(step(facts)).toBe(expected)
        })
    })
})

describe('isLegacyWorkspace', () => {
    it('is every workspace before the release', () => {
        expect(isLegacyWorkspace({ createdAt: AFTER, onboardedAt: null, foreman: profiled }, null)).toBe(true)
    })

    it('is not a workspace that wrote a profile, whenever it was created', () => {
        expect(isLegacyWorkspace({ createdAt: BEFORE, onboardedAt: null, foreman: profiled }, RELEASED)).toBe(false)
    })
})
