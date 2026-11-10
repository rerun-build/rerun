// The proxy countries Linkup can sign in from. LinkedIn trusts a login from where the person usually
// is, so the default is read off the browser's locale and the user can change it.
export const LINKUP_COUNTRIES: readonly { code: string; name: string }[] = [
    { code: 'US', name: 'United States' },
    { code: 'CA', name: 'Canada' },
    { code: 'UK', name: 'United Kingdom' },
    { code: 'FR', name: 'France' },
    { code: 'BE', name: 'Belgium' },
    { code: 'CH', name: 'Switzerland' },
    { code: 'DE', name: 'Germany' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'ES', name: 'Spain' },
    { code: 'IT', name: 'Italy' },
    { code: 'PT', name: 'Portugal' },
    { code: 'IE', name: 'Ireland' },
    { code: 'AT', name: 'Austria' },
    { code: 'SE', name: 'Sweden' },
    { code: 'DK', name: 'Denmark' },
    { code: 'FI', name: 'Finland' },
    { code: 'PL', name: 'Poland' },
    { code: 'CZ', name: 'Czechia' },
    { code: 'RO', name: 'Romania' },
    { code: 'GR', name: 'Greece' },
    { code: 'TR', name: 'Türkiye' },
    { code: 'IL', name: 'Israel' },
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'ZA', name: 'South Africa' },
    { code: 'IN', name: 'India' },
    { code: 'SG', name: 'Singapore' },
    { code: 'JP', name: 'Japan' },
    { code: 'AU', name: 'Australia' },
    { code: 'BR', name: 'Brazil' },
    { code: 'MX', name: 'Mexico' },
    { code: 'AR', name: 'Argentina' },
]

const FALLBACK_COUNTRY = 'US'

// English keeps the names above; another language asks the browser for its own, under the ISO code
// (Linkup's UK is GB there).
export function linkupCountryName(country: { code: string; name: string }, locale: string): string {
    if (locale.startsWith('en')) return country.name
    try {
        return new Intl.DisplayNames([locale], { type: 'region' }).of(country.code === 'UK' ? 'GB' : country.code) ?? country.name
    } catch {
        return country.name
    }
}

// Linkup says UK where the locale says GB.
export function countryFromLocale(locale: string | undefined): string {
    const region = locale?.split(/[-_]/)[1]?.toUpperCase()
    const code = region === 'GB' ? 'UK' : region
    return LINKUP_COUNTRIES.some(country => country.code === code) ? (code as string) : FALLBACK_COUNTRY
}
