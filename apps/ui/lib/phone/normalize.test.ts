import { describe, expect, it } from 'vitest'

import { countryDialling, countryFlag, countryFromLocale, countryOfTyped, exampleNationalNumber, formatAsTyped, formatE164, isPhoneCountry, PHONE_COUNTRIES, readTypedPhone, searchCountries, toE164 } from './normalize'

describe('toE164', () => {
    it('reads a national number in the selected country', () => {
        expect(toE164('06 12 34 56 78', 'FR')).toBe('+33612345678')
        expect(toE164('(415) 555-2671', 'US')).toBe('+14155552671')
    })

    it('lets an international prefix win over the selected country', () => {
        expect(toE164('+33 6 12 34 56 78', 'US')).toBe('+33612345678')
    })

    it('refuses what no carrier could route', () => {
        expect(toE164('12345', 'FR')).toBeNull()
        expect(toE164('', 'FR')).toBeNull()
        expect(toE164('not a number', 'US')).toBeNull()
    })
})

describe('formatE164', () => {
    it('spaces a number the way its country writes it, and keeps what is not one', () => {
        expect(formatE164('+33612345678')).toBe('+33 6 12 34 56 78')
        expect(formatE164('12')).toBe('12')
    })
})

describe('countryOfTyped', () => {
    it('lets a complete number name its own country over the selected one', () => {
        expect(countryOfTyped('+7 701 123 45 67', 'RU')).toBe('KZ')
    })

    it('keeps the selected country for a national number', () => {
        expect(countryOfTyped('06 12 34 56 78', 'FR')).toBe('FR')
    })

    it('keeps the selected country while the number is incomplete', () => {
        expect(countryOfTyped('+7 70', 'RU')).toBe('RU')
        expect(countryOfTyped('', 'RU')).toBe('RU')
    })
})

describe('countryFromLocale', () => {
    it('takes the region of a full locale', () => {
        expect(countryFromLocale('fr-FR')).toBe('FR')
        expect(countryFromLocale('en-gb')).toBe('GB')
    })

    it('falls back when the locale names no known region', () => {
        expect(countryFromLocale('fr')).toBe('US')
        expect(countryFromLocale(undefined)).toBe('US')
        expect(countryFromLocale('es-419')).toBe('US')
    })
})

describe('PHONE_COUNTRIES', () => {
    it('lists every country with its name and calling code', () => {
        expect(PHONE_COUNTRIES.find(country => country.code === 'FR')).toEqual({ code: 'FR', name: 'France', callingCode: '33' })
        expect(isPhoneCountry('FR')).toBe(true)
        expect(isPhoneCountry('ZZ')).toBe(false)
    })
})

describe('readTypedPhone', () => {
    it('moves a typed calling code onto the country', () => {
        expect(readTypedPhone('+33', 'US')).toEqual({ country: 'FR', phone: '' })
        expect(readTypedPhone('+33612345678', 'US')).toEqual({ country: 'FR', phone: '6 12 34 56 78' })
        expect(readTypedPhone('0032470', 'FR')).toEqual({ country: 'BE', phone: '470' })
    })

    it('waits for a complete calling code', () => {
        expect(readTypedPhone('+3', 'US')).toEqual({ country: 'US', phone: '+3' })
        expect(readTypedPhone('06 12', 'FR')).toEqual({ country: 'FR', phone: '06 12' })
    })

    it('keeps the selected country when it shares the typed calling code', () => {
        expect(readTypedPhone('+1514', 'CA')).toEqual({ country: 'CA', phone: '(514)' })
        expect(readTypedPhone('+1514', 'FR')).toEqual({ country: 'US', phone: '(514)' })
        expect(readTypedPhone('+447911', 'FR').country).toBe('GB')
    })
})

describe('formatAsTyped', () => {
    it('spaces a number as it grows, with or without its trunk prefix', () => {
        expect(formatAsTyped('0612345', 'FR')).toBe('06 12 34 5')
        expect(formatAsTyped('61234', 'FR')).toBe('6 12 34')
        expect(formatAsTyped('4155552', 'US')).toBe('(415) 555-2')
    })
})

describe('country display', () => {
    it('draws the flag and an example number of a country', () => {
        expect(countryFlag('FR')).toBe('🇫🇷')
        expect(exampleNationalNumber('FR')).toBe('06 12 34 56 78')
    })
})

describe('countryDialling', () => {
    it('lands on the main country of a calling code', () => {
        expect(countryDialling('32', 'FR')).toBe('BE')
        expect(countryDialling('1', 'FR')).toBe('US')
    })

    it('keeps the selected country when it already dials the code', () => {
        expect(countryDialling('1', 'CA')).toBe('CA')
    })

    it('waits for a complete code', () => {
        expect(countryDialling('35', 'FR')).toBeNull()
        expect(countryDialling('', 'FR')).toBeNull()
    })
})

describe('searchCountries', () => {
    it('narrows by calling code, with or without the plus', () => {
        expect(searchCountries('+35').map(country => country.callingCode)).toEqual(expect.arrayContaining(['351', '353', '358']))
        expect(searchCountries('35').every(country => country.callingCode.startsWith('35'))).toBe(true)
    })

    it('narrows by name, names starting with the query first', () => {
        expect(searchCountries('bel').map(country => country.code)).toEqual(['BY', 'BE', 'BZ'])
        expect(searchCountries('ger')[0].code).toBe('DE')
    })

    it('lists every country for an empty query', () => {
        expect(searchCountries('')).toBe(PHONE_COUNTRIES)
        expect(searchCountries('zzz')).toEqual([])
    })
})
