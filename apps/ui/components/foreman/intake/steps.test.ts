import { describe, expect, it } from 'vitest'

import { EMPTY_DRAFT, furthestReachable, industryHint, intakeSteps, stepAnswered, toIntake } from './steps'

describe('intakeSteps', () => {
    it('asks for a name only when nothing holds one', () => {
        expect(intakeSteps(null)).toEqual(['company', 'role', 'name'])
        expect(intakeSteps('  ')).toEqual(['company', 'role', 'name'])
        expect(intakeSteps('Clément')).toEqual(['company', 'role'])
    })

    it('asks for the industry only when the site was skipped', () => {
        expect(intakeSteps(null, true)).toEqual(['company', 'industry', 'role', 'name'])
        expect(intakeSteps('Clément', true)).toEqual(['company', 'industry', 'role'])
    })
})

describe('stepAnswered', () => {
    it('counts a site, or passing on it, as an answer to the first question', () => {
        expect(stepAnswered('company', EMPTY_DRAFT)).toBe(false)
        expect(stepAnswered('company', { ...EMPTY_DRAFT, companyUrl: 'rerun.build' })).toBe(true)
        expect(stepAnswered('company', { ...EMPTY_DRAFT, websiteSkipped: true })).toBe(true)
        expect(stepAnswered('company', { ...EMPTY_DRAFT, industry: 'saas' })).toBe(false)
    })

    it('counts a picked industry or their own words as an answer to the second', () => {
        expect(stepAnswered('industry', { ...EMPTY_DRAFT, websiteSkipped: true })).toBe(false)
        expect(stepAnswered('industry', { ...EMPTY_DRAFT, industry: 'saas' })).toBe(true)
        expect(stepAnswered('industry', { ...EMPTY_DRAFT, industryLabel: 'bakery' })).toBe(true)
    })
})

describe('furthestReachable', () => {
    const steps = intakeSteps(null)

    it('stops at the first step left empty', () => {
        expect(furthestReachable(steps, EMPTY_DRAFT)).toBe(0)
        expect(furthestReachable(steps, { ...EMPTY_DRAFT, companyUrl: 'rerun.build' })).toBe(1)
        expect(furthestReachable(steps, { ...EMPTY_DRAFT, companyUrl: 'rerun.build', position: 'Founder' })).toBe(2)
        expect(furthestReachable(steps, { ...EMPTY_DRAFT, companyUrl: 'rerun.build', position: 'Founder', firstName: 'Théo' })).toBe(2)
    })

    it('holds a skipped site on the industry until one is given', () => {
        const skipped = intakeSteps(null, true)
        expect(furthestReachable(skipped, { ...EMPTY_DRAFT, websiteSkipped: true })).toBe(1)
        expect(furthestReachable(skipped, { ...EMPTY_DRAFT, websiteSkipped: true, industry: 'saas' })).toBe(2)
    })

    it('does not let a later answer jump over an empty step', () => {
        expect(furthestReachable(steps, { ...EMPTY_DRAFT, position: 'Founder', firstName: 'Théo' })).toBe(0)
    })
})

describe('toIntake', () => {
    it('trims everything away and keeps null rather than empty strings', () => {
        expect(toIntake({ ...EMPTY_DRAFT, companyUrl: '  ', position: ' Founder ' }, null)).toEqual({ companyUrl: null, industry: null, decidedIndustry: null, industryLabel: null, position: 'Founder', firstName: null })
    })

    it('carries the decided industry beside the picked one', () => {
        const intake = toIntake({ ...EMPTY_DRAFT, companyUrl: 'century21.fr' }, null, 'real-estate')
        expect(intake.industry).toBeNull()
        expect(intake.decidedIndustry).toBe('real-estate')
    })

    it('falls back on the name the account already carries', () => {
        expect(toIntake(EMPTY_DRAFT, 'Clément').firstName).toBe('Clément')
        expect(toIntake({ ...EMPTY_DRAFT, firstName: 'Théo' }, 'Clément').firstName).toBe('Théo')
    })
})

describe('industryHint', () => {
    it('classifies the site when there is one, their own words otherwise', () => {
        expect(industryHint({ ...EMPTY_DRAFT, companyUrl: 'rerun.build', industryLabel: 'bakery' })).toBe('rerun.build')
        expect(industryHint({ ...EMPTY_DRAFT, industryLabel: 'bakery' })).toBe('bakery')
        expect(industryHint(EMPTY_DRAFT)).toBeNull()
    })
})
