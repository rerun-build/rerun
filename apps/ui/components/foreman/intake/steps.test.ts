import { describe, expect, it } from 'vitest'

import { EMPTY_DRAFT, furthestReachable, industryHint, intakeSteps, stepAnswered, toIntake } from './steps'

describe('intakeSteps', () => {
    it('asks for a name only when nothing holds one', () => {
        expect(intakeSteps(null)).toEqual(['industry', 'company', 'role', 'name'])
        expect(intakeSteps('  ')).toEqual(['industry', 'company', 'role', 'name'])
        expect(intakeSteps('Clément')).toEqual(['industry', 'company', 'role'])
    })

    it('asks the kind of company first, whether a site follows or not', () => {
        expect(intakeSteps(null)[0]).toBe('industry')
        expect(intakeSteps('Clément').indexOf('company')).toBe(1)
    })
})

describe('stepAnswered', () => {
    it('counts a site, or passing on it, as an answer to the site question', () => {
        expect(stepAnswered('company', EMPTY_DRAFT)).toBe(false)
        expect(stepAnswered('company', { ...EMPTY_DRAFT, companyUrl: 'rerun.build' })).toBe(true)
        expect(stepAnswered('company', { ...EMPTY_DRAFT, websiteSkipped: true })).toBe(true)
        expect(stepAnswered('company', { ...EMPTY_DRAFT, industry: 'saas' })).toBe(false)
    })

    it('counts a picked kind or their own words as an answer to the first', () => {
        expect(stepAnswered('industry', { ...EMPTY_DRAFT, websiteSkipped: true })).toBe(false)
        expect(stepAnswered('industry', { ...EMPTY_DRAFT, industry: 'saas' })).toBe(true)
        expect(stepAnswered('industry', { ...EMPTY_DRAFT, industry: 'studio' })).toBe(true)
        expect(stepAnswered('industry', { ...EMPTY_DRAFT, industryLabel: 'bakery' })).toBe(true)
    })
})

describe('furthestReachable', () => {
    const steps = intakeSteps(null)

    it('stops at the first step left empty', () => {
        expect(furthestReachable(steps, EMPTY_DRAFT)).toBe(0)
        expect(furthestReachable(steps, { ...EMPTY_DRAFT, industry: 'saas' })).toBe(1)
        expect(furthestReachable(steps, { ...EMPTY_DRAFT, industry: 'saas', companyUrl: 'rerun.build' })).toBe(2)
        expect(furthestReachable(steps, { ...EMPTY_DRAFT, industry: 'saas', companyUrl: 'rerun.build', position: 'Founder' })).toBe(3)
        expect(furthestReachable(steps, { ...EMPTY_DRAFT, industry: 'saas', companyUrl: 'rerun.build', position: 'Founder', firstName: 'Théo' })).toBe(3)
    })

    it('holds the card on the kind until one is given, a site or not', () => {
        expect(furthestReachable(steps, { ...EMPTY_DRAFT, companyUrl: 'rerun.build' })).toBe(0)
        expect(furthestReachable(steps, { ...EMPTY_DRAFT, industryLabel: 'bakery', websiteSkipped: true })).toBe(2)
    })

    it('does not let a later answer jump over an empty step', () => {
        expect(furthestReachable(steps, { ...EMPTY_DRAFT, position: 'Founder', firstName: 'Théo' })).toBe(0)
    })
})

describe('toIntake', () => {
    it('trims everything away and keeps null rather than empty strings', () => {
        expect(toIntake({ ...EMPTY_DRAFT, companyUrl: '  ', position: ' Founder ' }, null)).toEqual({ companyUrl: null, industry: null, decidedIndustry: null, industryLabel: null, position: 'Founder', firstName: null, boxes: null })
    })

    it('hands over the teams proposed for their own words, and the studio as picked', () => {
        expect(toIntake({ ...EMPTY_DRAFT, industryLabel: 'Pottery studio' }, null, 'creators', ['Workshop', 'Shop', 'Classes', 'Admin']).boxes).toEqual(['Workshop', 'Shop', 'Classes', 'Admin'])
        expect(toIntake({ ...EMPTY_DRAFT, industry: 'studio' }, null).industry).toBe('studio')
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
    it('classifies their own words over the site, and the site only when they said nothing of the kind', () => {
        expect(industryHint({ ...EMPTY_DRAFT, companyUrl: 'rerun.build', industryLabel: 'bakery' })).toBe('bakery')
        expect(industryHint({ ...EMPTY_DRAFT, industryLabel: 'bakery' })).toBe('bakery')
        expect(industryHint({ ...EMPTY_DRAFT, companyUrl: 'rerun.build' })).toBe('rerun.build')
        expect(industryHint(EMPTY_DRAFT)).toBeNull()
    })

    it('never lets a site override a kind they picked', () => {
        expect(industryHint({ ...EMPTY_DRAFT, industry: 'legal', companyUrl: 'rerun.build' })).toBeNull()
        expect(industryHint({ ...EMPTY_DRAFT, industry: 'studio', companyUrl: 'rerun.build' })).toBeNull()
    })
})
