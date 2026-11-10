import { countryByCode, flagOf, formatAsTyped, internationalNumber, isPossibleNumber, searchCountries } from '@/lib/phone'

describe('phone helpers', () => {
    it('draws the flag of a country from its code', () => {
        expect(flagOf('fr')).toBe('🇫🇷')
    })

    it('formats the number as it is typed, in the national style of the country', () => {
        expect(formatAsTyped('0612345678', 'FR')).toBe('06 12 34 56 78')
    })

    it('shows the number the code went to in its international form', () => {
        expect(internationalNumber('06 12 34 56 78', 'FR')).toBe('+33 6 12 34 56 78')
    })

    it('stops a number too short to be one before the hub is asked', () => {
        expect(isPossibleNumber('06 12', 'FR')).toBe(false)
        expect(isPossibleNumber('06 12 34 56 78', 'FR')).toBe(true)
    })

    it('names the calling regions the ISO table leaves out, so they do not sort first as a bare code', () => {
        expect(countryByCode('AC').name).toBe('Ascension Island')
    })

    it('names the countries in the language of the app', () => {
        expect(countryByCode('DE', 'fr').name).toBe('Allemagne')
        expect(searchCountries('alema', 'es').map(country => country.code)).toContain('DE')
        expect(searchCountries('alema', 'pt').map(country => country.code)).toContain('DE')
        expect(countryByCode('FR', 'de').name).toBe('Frankreich')
    })

    it('names the countries the Brazilian way, not the European one the ISO table ships', () => {
        expect(countryByCode('IR', 'pt').name).toBe('Irã')
        expect(countryByCode('CD', 'pt').name).toBe('República Democrática do Congo')
        expect(searchCountries('estôn', 'pt').map(country => country.code)).toContain('EE')
        expect(searchCountries('irão', 'pt')).toHaveLength(0)
    })

    it('finds a country by name, by calling code or by its code', () => {
        expect(searchCountries('franc').map(country => country.code)).toContain('FR')
        expect(searchCountries('+44').map(country => country.code)).toContain('GB')
        expect(searchCountries('de')[0]).toBeDefined()
    })
})
