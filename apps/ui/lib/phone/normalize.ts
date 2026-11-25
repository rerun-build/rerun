import { AsYouType, getCountries, getCountryCallingCode, getExampleNumber, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min'
import metadata from 'libphonenumber-js/min/metadata'
import mobileExamples from 'libphonenumber-js/mobile/examples'

export type PhoneCountry = { code: CountryCode; name: string; callingCode: string }

const FALLBACK_COUNTRY: CountryCode = 'US'

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

export const PHONE_COUNTRIES: PhoneCountry[] = getCountries()
    .map(code => ({ code, name: regionNames.of(code) ?? code, callingCode: getCountryCallingCode(code) }))
    .sort((a, b) => a.name.localeCompare(b.name))

const KNOWN_COUNTRIES = new Set<string>(getCountries())

export const isPhoneCountry = (value: string): value is CountryCode => KNOWN_COUNTRIES.has(value)

// `fr-FR` names its region, `fr` alone does not: a bare language says nothing about where its
// speaker lives, so it falls back rather than guess.
export function countryFromLocale(locale: string | undefined): CountryCode {
    const region = locale?.split('-')[1]?.toUpperCase()
    return region && isPhoneCountry(region) ? region : FALLBACK_COUNTRY
}

// Null for anything a carrier could not route. A number typed with its own `+` prefix wins over
// the selected country.
export function toE164(input: string, country: CountryCode): string | null {
    const parsed = parsePhoneNumberFromString(input, country)
    return parsed?.isValid() ? parsed.number : null
}

export const formatE164 = (phone: string): string => parsePhoneNumberFromString(phone)?.formatInternational() ?? phone

export const countryOfE164 = (phone: string): CountryCode | undefined => parsePhoneNumberFromString(phone)?.country

// The country the number itself names once it is complete, the selected one until then: a `+7`
// number is Russian or Kazakh by its digits, not by the picker.
export function countryOfTyped(input: string, country: CountryCode): CountryCode {
    const parsed = parsePhoneNumberFromString(input, country)
    return parsed?.isValid() && parsed.country ? parsed.country : country
}

const REGIONAL_INDICATOR_OFFSET = 0x1f1e6 - 'A'.charCodeAt(0)

export const countryFlag = (country: CountryCode) => String.fromCodePoint(...[...country].map(letter => letter.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET))

export const exampleNationalNumber = (country: CountryCode) => getExampleNumber(country, mobileExamples)?.formatNational() ?? ''

// A national number typed without its trunk prefix (`6 12…` in France) is left unspaced by the
// national formatter, so it borrows the spacing of its international form.
export function formatAsTyped(input: string, country: CountryCode): string {
    const national = new AsYouType(country).input(input)
    if (/\D/.test(national)) return national
    const prefix = `+${getCountryCallingCode(country)}`
    return new AsYouType().input(prefix + input).slice(prefix.length).trim()
}

// Calling codes are prefix-free, so a full match is the only one. Several countries share a code
// (`+1`, `+44`, `+7`): the selected country is kept when it already dials it, otherwise the main
// country of that code wins.
export function countryDialling(callingCode: string, country: CountryCode): CountryCode | null {
    const countries: readonly string[] | undefined = metadata.country_calling_codes[callingCode]
    if (!countries) return null
    if (countries.includes(country)) return country
    return isPhoneCountry(countries[0]) ? countries[0] : null
}

export function readTypedPhone(input: string, country: CountryCode): { country: CountryCode; phone: string } {
    const typer = new AsYouType(country)
    typer.input(input)
    const callingCode = typer.isInternational() ? typer.getCallingCode() : undefined
    if (!callingCode) return { country, phone: input }
    const dialled = countryDialling(callingCode, country) ?? country
    return { country: dialled, phone: formatAsTyped(typer.getNumber()?.nationalNumber ?? '', dialled) }
}

// Digits search the calling codes, anything else the names, those starting with the query first.
export function searchCountries(query: string): PhoneCountry[] {
    const needle = query.replace(/^\+/, '').trim().toLowerCase()
    if (!needle) return PHONE_COUNTRIES
    if (/^\d+$/.test(needle)) return PHONE_COUNTRIES.filter(candidate => candidate.callingCode.startsWith(needle))
    const startsWithNeedle = (candidate: PhoneCountry) => Number(candidate.name.toLowerCase().startsWith(needle))
    return PHONE_COUNTRIES.filter(candidate => candidate.name.toLowerCase().includes(needle)).sort((a, b) => startsWithNeedle(b) - startsWithNeedle(a))
}
