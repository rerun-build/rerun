import messages from '@rerun/i18n/messages/en/onboarding.json'
import fr from '@rerun/i18n/messages/fr/onboarding.json'
import { isTemplateCategory } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { FIRST_SECTORS, isOwnUse, SECTORS, searchSectors, sectorById, type SectorId } from './sectors'

const wordsIn = (pack: { sectors: Record<SectorId, { label: string; keywords: string }> }) => (id: SectorId) => `${pack.sectors[id].label} ${pack.sectors[id].keywords}`
const found = (query: string, pack: Parameters<typeof wordsIn>[0] = messages) => searchSectors(query, wordsIn(pack)).map(sector => sector.id)

describe('SECTORS', () => {
    it('files every line of work under a template category, and names each one once', () => {
        expect(SECTORS.every(sector => isTemplateCategory(sector.category))).toBe(true)
        expect(new Set(SECTORS.map(sector => sector.id)).size).toBe(SECTORS.length)
    })

    it('has the label and the search words of every one, and nothing more', () => {
        expect(Object.keys(messages.sectors).sort()).toEqual(SECTORS.map(sector => sector.id).sort())
    })

    it('shows first lines of work that exist', () => {
        expect(FIRST_SECTORS.every(id => sectorById(id))).toBe(true)
        expect(sectorById('bakery')).toBeNull()
    })

    it('knows who has no company behind them', () => {
        expect(SECTORS.filter(sector => isOwnUse(sector.id)).map(sector => sector.id)).toEqual(['personal', 'student'])
    })
})

describe('searchSectors', () => {
    it('finds a line of work by the words people use for it', () => {
        expect(found('dentist')).toEqual(['health'])
        expect(found('Bakery')).toEqual(['hospitality'])
        expect(found('side project')).toEqual(['personal'])
        expect(found('university')).toEqual(['student'])
    })

    it('finds it in the language of the person, accents or not', () => {
        expect(found('dentiste', fr)).toEqual(['health'])
        expect(found('etudiant', fr)).toContain('student')
    })

    it('finds nothing for an empty search or a line of work nobody listed', () => {
        expect(found('  ')).toEqual([])
        expect(found('falconry')).toEqual([])
    })
})
