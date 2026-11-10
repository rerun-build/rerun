import { TEMPLATE_CATEGORIES } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { DEFAULT_ROLES, INTAKE_INDUSTRIES, intakeBoxes, intakePreviewPlan, rolesForIndustry } from './intake'

describe('INTAKE_INDUSTRIES', () => {
    it('offers every bucket but the one nobody recognises themselves in', () => {
        expect(INTAKE_INDUSTRIES.map(option => option.value)).toEqual(TEMPLATE_CATEGORIES.filter(category => category !== 'other'))
    })
})

describe('intakeBoxes', () => {
    it('draws three to five divisions for every industry, the label a jsonb column can hold included', () => {
        for (const category of TEMPLATE_CATEGORIES) {
            const boxes = intakeBoxes(category)
            expect(boxes.length).toBeGreaterThanOrEqual(3)
            expect(boxes.length).toBeLessThanOrEqual(5)
        }
    })

    it('falls back on the universal divisions rather than on nothing', () => {
        expect(intakeBoxes(null)).toEqual(intakeBoxes('other'))
        expect(intakeBoxes('bakery')).toEqual(intakeBoxes(undefined))
        expect(intakeBoxes('bakery').length).toBe(5)
    })
})

describe('rolesForIndustry', () => {
    it('gives four roles per industry and the universal ones when it says nothing', () => {
        for (const category of TEMPLATE_CATEGORIES) expect(rolesForIndustry(category).length).toBe(4)
        expect(rolesForIndustry('other')).toEqual(DEFAULT_ROLES)
        expect(rolesForIndustry('bakery')).toEqual(DEFAULT_ROLES)
        expect(rolesForIndustry(null)).toEqual(DEFAULT_ROLES)
    })
})

describe('intakePreviewPlan', () => {
    it('is the plan card shape with nobody hired in it', () => {
        const plan = intakePreviewPlan('saas', 'Retalk')
        expect(plan.title).toBe('Retalk')
        expect(plan.groups.map(group => group.name)).toEqual(intakeBoxes('saas'))
        expect(plan.groups.every(group => group.items.length === 0)).toBe(true)
    })

    it('keeps its keys apart so two divisions of the same name never collapse', () => {
        const keys = intakePreviewPlan('agencies').groups.map(group => group.key)
        expect(new Set(keys).size).toBe(keys.length)
    })
})
