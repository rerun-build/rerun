import { DEFAULT_LOCALE, type Locale } from '@rerun/i18n'
import countries from 'i18n-iso-countries'
import english from 'i18n-iso-countries/langs/en.json'
import spanish from 'i18n-iso-countries/langs/es.json'
import french from 'i18n-iso-countries/langs/fr.json'
import { getLocales } from 'expo-localization'
import { AsYouType, getCountries, getCountryCallingCode, getExampleNumber, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min'
import mobileExamples from 'libphonenumber-js/mobile/examples'

countries.registerLocale(english)
countries.registerLocale(french)
countries.registerLocale(spanish)

export type PhoneCountry = { code: CountryCode; name: string; callingCode: string; flag: string }

const FALLBACK_COUNTRY: CountryCode = 'US'

// Hermes has no Intl.DisplayNames, so the names come from a table rather than from the platform.
export const flagOf = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65))

// Calling regions of their own that the ISO table does not list as countries.
const MISSING_NAMES: Record<Locale, Partial<Record<CountryCode, string>>> = {
    en: { AC: 'Ascension Island', TA: 'Tristan da Cunha' },
    fr: { AC: 'Île de l’Ascension', TA: 'Tristan da Cunha' },
    es: { AC: 'Isla Ascensión', TA: 'Tristán de Acuña' },
}

const countriesByLocale = new Map<Locale, PhoneCountry[]>()

// The countries named in the app's language, in that language's alphabetical order.
export function phoneCountries(locale: Locale = DEFAULT_LOCALE): PhoneCountry[] {
    let list = countriesByLocale.get(locale)
    if (!list) {
        list = getCountries()
            .map(code => ({ code, name: countries.getName(code, locale) ?? MISSING_NAMES[locale][code] ?? countries.getName(code, 'en') ?? code, callingCode: getCountryCallingCode(code), flag: flagOf(code) }))
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

// Possible, not valid: the hub has the last word, and a number a carrier added last month must not be
// stopped by the copy of the metadata this build carries.
export const isPossibleNumber = (input: string, country: CountryCode) => parsePhoneNumberFromString(input, country)?.isPossible() ?? false

export const internationalNumber = (input: string, country: CountryCode) => parsePhoneNumberFromString(input, country)?.formatInternational() ?? input

export function searchCountries(query: string, locale: Locale = DEFAULT_LOCALE): PhoneCountry[] {
    const needle = query.trim().toLocaleLowerCase(locale).replace(/^\+/, '')
    const list = phoneCountries(locale)
    if (!needle) return list
    return list.filter(country => country.name.toLocaleLowerCase(locale).includes(needle) || country.callingCode.startsWith(needle) || country.code.toLowerCase() === needle)
}
