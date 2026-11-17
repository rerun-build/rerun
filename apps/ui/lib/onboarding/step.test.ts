import { describe, expect, it } from 'vitest'

import type { ForemanAnswers } from '@/lib/foreman/phase'
import { needsOnboarding, onboardingStep, type NeedsOnboardingInput } from './step'

const ANSWERED: ForemanAnswers = { company_url: 'https://acme.com', industry: 'saas', position: 'Founder / CEO', onboarding: { teamDone: true } }

describe('onboardingStep', () => {
    const step = (answers: ForemanAnswers, entitled = false, billing = true) => onboardingStep({ answers, entitled, billing })

    it('starts on the website of a workspace that answered nothing', () => {
        expect(step({})).toBe('site')
    })

    it('moves past the website once it is given or skipped', () => {
        expect(step({ company_url: 'https://acme.com' })).toBe('industry')
        expect(step({ onboarding: { siteSkipped: true } })).toBe('industry')
    })

    it('asks the industry, then the role, then the team, in that order', () => {
        expect(step({ company_url: 'https://acme.com', position: 'Founder / CEO' })).toBe('industry')
        expect(step({ company_url: 'https://acme.com', industry: 'other', onboarding: { industryLabel: 'Bakery' } })).toBe('role')
        expect(step({ company_url: 'https://acme.com', industry: 'saas', position: '  ' })).toBe('role')
        expect(step({ company_url: 'https://acme.com', industry: 'saas', position: 'Sales' })).toBe('team')
    })

    it('asks for the trial once the questions are answered, unless the workspace is already entitled', () => {
        expect(step(ANSWERED)).toBe('trial')
        expect(step(ANSWERED, true)).toBe('engine')
    })

    it('never asks for a trial where nothing is sold', () => {
        expect(step(ANSWERED, false, false)).toBe('engine')
    })

    it('resumes where a reload leaves it: answers written earlier are never asked again', () => {
        const halfway: ForemanAnswers = { company_url: 'https://acme.com', industry: 'ecommerce' }
        expect(step(halfway)).toBe('role')
        expect(step({ ...halfway, position: 'Operations' })).toBe('team')
    })
})

describe('needsOnboarding', () => {
    const FRESH: NeedsOnboardingInput = { role: 'admin', onboardedAt: null, isSandbox: false, archived: false, agentCount: 0, paying: false, inHubFunnel: false, arrivingByInvite: false, hubForeman: true }

    it('walks the admin of a brand new workspace through it', () => {
        expect(needsOnboarding(FRESH)).toBe(true)
    })

    it('leaves members and invited people alone', () => {
        expect(needsOnboarding({ ...FRESH, role: 'member' })).toBe(false)
        expect(needsOnboarding({ ...FRESH, role: null })).toBe(false)
        expect(needsOnboarding({ ...FRESH, arrivingByInvite: true })).toBe(false)
    })

    it('leaves a workspace that is already running alone', () => {
        expect(needsOnboarding({ ...FRESH, onboardedAt: '2026-11-01T00:00:00Z' })).toBe(false)
        expect(needsOnboarding({ ...FRESH, agentCount: 2 })).toBe(false)
        expect(needsOnboarding({ ...FRESH, paying: true })).toBe(false)
        expect(needsOnboarding({ ...FRESH, isSandbox: true })).toBe(false)
        expect(needsOnboarding({ ...FRESH, archived: true })).toBe(false)
    })

    it('lets a workspace that started the onboarding chat finish it there', () => {
        expect(needsOnboarding({ ...FRESH, inHubFunnel: true })).toBe(false)
    })

    it('has no onboarding on a self-hosted install without a model key', () => {
        expect(needsOnboarding({ ...FRESH, hubForeman: false })).toBe(false)
    })
})
