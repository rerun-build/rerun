import { DEFAULT_LOCALE, type Locale } from '@moldwright/i18n'
import countries from 'i18n-iso-countries'
import german from 'i18n-iso-countries/langs/de.json'
import english from 'i18n-iso-countries/langs/en.json'
import spanish from 'i18n-iso-countries/langs/es.json'
import french from 'i18n-iso-countries/langs/fr.json'
import portuguese from 'i18n-iso-countries/langs/pt.json'
import { getLocales } from 'expo-localization'
import { AsYouType, getCountries, getCountryCallingCode, getExampleNumber, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min'
import mobileExamples from 'libphonenumber-js/mobile/examples'

countries.registerLocale(english)
countries.registerLocale(french)
countries.registerLocale(spanish)
countries.registerLocale(portuguese)
countries.registerLocale(german)

export type PhoneCountry = { code: CountryCode; name: string; callingCode: string; flag: string }

const FALLBACK_COUNTRY: CountryCode = 'US'

export const flagOf = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65))

const MISSING_NAMES: Record<Locale, Partial<Record<CountryCode, string>>> = {
    en: { AC: 'Ascension Island', TA: 'Tristan da Cunha' },
    fr: { AC: 'Île de l’Ascension', TA: 'Tristan da Cunha' },
    es: { AC: 'Isla Ascensión', TA: 'Tristán de Acuña' },
    pt: { AC: 'Ilha de Ascensão', TA: 'Tristão da Cunha' },
    de: { AC: 'Ascension', TA: 'Tristan da Cunha' },
}

const REGIONAL_NAMES: Partial<Record<Locale, Partial<Record<CountryCode, string>>>> = {
    pt: {
        AM: 'Armênia',
        BA: 'Bósnia e Herzegovina',
        BF: 'Burquina Faso',
        BH: 'Barein',
        BJ: 'Benin',
        CD: 'República Democrática do Congo',
        CG: 'República do Congo',
        CX: 'Ilha Christmas',
        CZ: 'Tchéquia',
        DJ: 'Djibuti',
        EE: 'Estônia',
        GL: 'Groenlândia',
        HK: 'Hong Kong',
        IR: 'Irã',
        KE: 'Quênia',
        KN: 'São Cristóvão e Névis',
        KW: 'Kuwait',
        KY: 'Ilhas Cayman',
        LV: 'Letônia',
        MC: 'Mônaco',
        MG: 'Madagascar',
        MK: 'Macedônia do Norte',
        MO: 'Macau',
        MS: 'Montserrat',
        MU: 'Maurício',
        MW: 'Malaui',
        NC: 'Nova Caledônia',
        PL: 'Polônia',
        PM: 'São Pedro e Miquelão',
        QA: 'Catar',
        RO: 'Romênia',
        SC: 'Seicheles',
        SI: 'Eslovênia',
        SX: 'Sint Maarten',
        TJ: 'Tadjiquistão',
        TM: 'Turcomenistão',
        TT: 'Trinidad e Tobago',
        VA: 'Cidade do Vaticano',
        VN: 'Vietnã',
        YE: 'Iêmen',
    },
}

const countriesByLocale = new Map<Locale, PhoneCountry[]>()

function countryName(code: CountryCode, locale: Locale): string {
    return REGIONAL_NAMES[locale]?.[code] ?? countries.getName(code, locale) ?? MISSING_NAMES[locale][code] ?? countries.getName(code, 'en') ?? code
}

export function phoneCountries(locale: Locale = DEFAULT_LOCALE): PhoneCountry[] {
    let list = countriesByLocale.get(locale)
    if (!list) {
        list = getCountries()
            .map(code => ({ code, name: countryName(code, locale), callingCode: getCountryCallingCode(code), flag: flagOf(code) }))
            .sort((a, b) => a.name.localeCompare(b.name, locale))
        countriesByLocale.set(locale, list)
    }
    return list
}

const KNOWN = new Set<string>(getCountries())

export function countryByCode(code: CountryCode, locale: Locale = DEFAULT_LOCALE): PhoneCountry {
    const list = phoneCountries(locale)
    return list.find(country => country.code === code) ?? list[0]
}

export function deviceCountry(): CountryCode {
    const region = getLocales()[0]?.regionCode?.toUpperCase()
    return region && KNOWN.has(region) ? (region as CountryCode) : FALLBACK_COUNTRY
}

export const formatAsTyped = (input: string, country: CountryCode) => new AsYouType(country).input(input)

export const examplePlaceholder = (country: CountryCode) => getExampleNumber(country, mobileExamples)?.formatNational() ?? ''

export const isPossibleNumber = (input: string, country: CountryCode) => parsePhoneNumberFromString(input, country)?.isPossible() ?? false

export const internationalNumber = (input: string, country: CountryCode) => parsePhoneNumberFromString(input, country)?.formatInternational() ?? input

export function searchCountries(query: string, locale: Locale = DEFAULT_LOCALE): PhoneCountry[] {
    const needle = query.trim().toLocaleLowerCase(locale).replace(/^\+/, '')
    const list = phoneCountries(locale)
    if (!needle) return list
    return list.filter(country => country.name.toLocaleLowerCase(locale).includes(needle) || country.callingCode.startsWith(needle) || country.code.toLowerCase() === needle)
}
