import { describe, expect, it } from 'vitest'

import type { ForemanAnswers } from '@/lib/foreman/phase'
import { needsOnboarding, onboardingStep, type NeedsOnboardingInput } from './step'

const ANSWERED: ForemanAnswers = { industry: 'saas', onboarding: { sector: 'saas', teamDone: true, view: 'simple' } }

describe('onboardingStep', () => {
    const step = (answers: ForemanAnswers, entitled = false, billing = true) => onboardingStep({ answers, entitled, billing })

    it('starts on the line of work of a workspace that answered nothing', () => {
        expect(step({})).toBe('industry')
    })

    it('asks the team, then how to see the workspace', () => {
        expect(step({ industry: 'other', onboarding: { industryLabel: 'Bakery' } })).toBe('team')
        expect(step({ ...ANSWERED, onboarding: { teamDone: true } })).toBe('view')
        expect(step({ ...ANSWERED, onboarding: { teamDone: true, view: 'simple' } })).toBe('trial')
    })

    it('never asks for the website nor the role, which earlier versions waited on', () => {
        expect(step({ onboarding: { siteSkipped: true } })).toBe('industry')
        expect(step({ company_url: 'https://acme.com', industry: 'saas' })).toBe('team')
    })

    it('asks for the trial once the questions are answered, unless the workspace is already entitled', () => {
        expect(step(ANSWERED)).toBe('trial')
        expect(step(ANSWERED, true)).toBe('engine')
    })

    it('never asks for a trial where nothing is sold', () => {
        expect(step(ANSWERED, false, false)).toBe('engine')
    })

    it('resumes where a reload leaves it: answers written earlier are never asked again', () => {
        const halfway: ForemanAnswers = { industry: 'ecommerce', onboarding: { sector: 'ecommerce' } }
        expect(step(halfway)).toBe('team')
        expect(step({ ...halfway, onboarding: { ...halfway.onboarding, teamDone: true } })).toBe('view')
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
