import { describe, expect, it } from 'vitest'

import { boxNameFrom, firstBoxName, industryFromAnswers } from './box-name'
import { DEFAULT_BOX_NAMES, INDUSTRY_BOX_NAMES } from './box-name-suggestions'

describe('industryFromAnswers', () => {
    it('reads the industry the website analysis wrote', () => {
        expect(industryFromAnswers({ industry: 'saas' })).toBe('saas')
    })

    it('falls back to the work type, then to the sector', () => {
        expect(industryFromAnswers({ work_type: 'consulting' })).toBe('agencies')
        expect(industryFromAnswers({ sector: 'legal' })).toBe('legal')
    })

    it('says nothing on an empty row', () => {
        expect(industryFromAnswers(null)).toBeNull()
        expect(industryFromAnswers({})).toBeNull()
    })
})

describe('firstBoxName', () => {
    it('takes the most universal division of the industry', () => {
        expect(firstBoxName('saas', [])).toBe(INDUSTRY_BOX_NAMES.saas[0])
    })

    it('falls back to the neutral divisions', () => {
        expect(firstBoxName(null, [])).toBe(DEFAULT_BOX_NAMES[0])
        expect(firstBoxName('healthcare', [])).toBe(DEFAULT_BOX_NAMES[0])
    })

    it('skips the names the workspace already uses', () => {
        expect(firstBoxName('saas', [INDUSTRY_BOX_NAMES.saas[0]])).toBe(INDUSTRY_BOX_NAMES.saas[1])
    })

    it('still names a Box when every suggestion is taken', () => {
        expect(firstBoxName('saas', INDUSTRY_BOX_NAMES.saas)).toBeTruthy()
        expect(firstBoxName(null, DEFAULT_BOX_NAMES)).toBeTruthy()
    })
})

describe('boxNameFrom', () => {
    it('takes the company, then the first name, then the division', () => {
        expect(boxNameFrom({ companyName: 'Acme', firstName: 'Clément', industry: 'saas', taken: [] })).toBe('Acme')
        expect(boxNameFrom({ firstName: 'Clément', industry: 'saas', taken: [] })).toBe('Clément')
        expect(boxNameFrom({ industry: 'saas', taken: [] })).toBe(INDUSTRY_BOX_NAMES.saas[0])
    })

    it('never returns an empty name', () => {
        expect(boxNameFrom({ companyName: '  ', firstName: '  ', taken: [] })).toBeTruthy()
    })
})
