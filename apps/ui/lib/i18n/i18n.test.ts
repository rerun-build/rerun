import { loadMessages } from '@rerun/i18n/messages'
import { localeNativeName, matchLocale, parseAcceptLanguage, resolveLocale } from '@rerun/i18n'
import { formatBytes, formatDuration, longDate, messageDayLabel, shortDate, shortRelativeTime, shortUntil, weekdayNames } from '@rerun/i18n/format'
import { pseudoLocalize } from '@rerun/i18n/pseudo'
import { mergeMessages } from '@rerun/i18n'
import { describe, expect, it } from 'vitest'

const NOW = new Date('2026-11-09T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
// ICU separates a number from its unit with a (narrow) no-break space.
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('resolveLocale', () => {
    it('takes the account first, then the cookie, then the browser', () => {
        expect(resolveLocale({ userLocale: 'es', cookie: 'fr', acceptLanguage: 'en' })).toBe('es')
        expect(resolveLocale({ userLocale: null, cookie: 'fr', acceptLanguage: 'es' })).toBe('fr')
        expect(resolveLocale({ acceptLanguage: 'de-DE,es;q=0.8,fr;q=0.9' })).toBe('fr')
        expect(resolveLocale({ acceptLanguage: 'de-DE' })).toBe('en')
        expect(resolveLocale({})).toBe('en')
    })

    it('ignores what it does not ship', () => {
        expect(resolveLocale({ userLocale: 'de', cookie: 'xx', acceptLanguage: 'es-MX' })).toBe('es')
        expect(matchLocale('FR-ca')).toBe('fr')
        expect(parseAcceptLanguage('*, fr;q=0')).toBeNull()
    })

    it('names each language in its own words', () => {
        expect(localeNativeName('fr')).toBe('Français')
        expect(localeNativeName('es')).toBe('Español')
        expect(localeNativeName('en')).toBe('English')
    })
})

describe('format', () => {
    it('keeps the English output it had before the packs', () => {
        expect(shortRelativeTime(ago(30_000), 'en', NOW)).toBe('now')
        expect(shortRelativeTime(ago(5 * MINUTE), 'en', NOW)).toBe('5m')
        expect(shortRelativeTime(ago(3 * HOUR), 'en', NOW)).toBe('3h')
        expect(shortRelativeTime(ago(2 * DAY), 'en', NOW)).toBe('2d')
        expect(shortUntil(ahead(5 * MINUTE + 1000), 'en', NOW)).toBe('in 5m')
        expect(shortDate('2026-03-05T12:00:00Z', 'en')).toBe('Mar 5')
        expect(longDate('2026-03-05T12:00:00Z', 'en')).toBe('Mar 5, 2026')
        expect(formatBytes(1536, 'en')).toBe('1.5 KB')
        expect(formatDuration(125 * MINUTE, 'en')).toBe('2h 5m')
        expect(weekdayNames('en')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    })

    it('speaks French and Spanish', () => {
        expect(shortRelativeTime(ago(30_000), 'fr', NOW)).toBe('maintenant')
        expect(shortRelativeTime(ago(2 * DAY), 'fr', NOW)).toBe('2j')
        expect(shortRelativeTime(ago(30_000), 'es', NOW)).toBe('ahora')
        expect(plain(shortUntil(ahead(3 * HOUR + 1000), 'fr', NOW))).toBe('dans 3 h')
        expect(shortDate('2026-03-05T12:00:00Z', 'fr')).toBe('5 mars')
        expect(plain(formatBytes(1536, 'fr'))).toBe('1,5 ko')
    })

    it('labels the days of a conversation', () => {
        const today = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 10).toISOString()
        const yesterday = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1, 10).toISOString()
        expect(messageDayLabel(today, 'en', NOW)).toBe('Today')
        expect(messageDayLabel(yesterday, 'en', NOW)).toBe('Yesterday')
        expect(messageDayLabel(today, 'fr', NOW)).toBe('Aujourd’hui')
        expect(messageDayLabel(yesterday, 'es', NOW)).toBe('Ayer')
    })
})

describe('pseudoLocalize', () => {
    it('stretches the words and leaves the ICU syntax and the tags alone', () => {
        expect(pseudoLocalize('{count, plural, one {# file} other {# files}} in <b>{name}</b>')).toBe('[{count, plural, one {# ƒíļé} other {# ƒíļéš}} íñ <b>{name}</b> ~~~~]')
    })
})

describe('messages', () => {
    it('falls back to English for a key a pack lacks', () => {
        expect(mergeMessages({ a: 'A', b: { c: 'C', d: 'D' } }, { b: { c: 'C fr' } })).toEqual({ a: 'A', b: { c: 'C fr', d: 'D' } })
    })

    it('loads the packs without the translator notes', async () => {
        const fr = await loadMessages('fr')
        expect(fr.account.title).toBe('Compte')
        expect('_context' in fr.account).toBe(false)
        expect((await loadMessages('en-XA')).common.save).toBe('[Šáṽé ~~]')
    })
})
