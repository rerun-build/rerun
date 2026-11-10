import { loadMessages } from '@rerun/i18n/messages'
import { createTranslator } from 'use-intl'
import { describe, expect, it } from 'vitest'

import { englishTranslator } from '@/lib/i18n/english-translator'
import { humanCron, nextRunAt, routineFrequency, scheduleSummary } from '@/lib/schedules/cron'

const english = englishTranslator('agent')
const french = createTranslator({ locale: 'fr', messages: await loadMessages('fr'), namespace: 'agent' })

const NOW = new Date('2026-09-30T10:00:00.000Z')
const RECURRING = { enabled: true, cron: '0 9 * * *', runAt: null, timezone: 'Europe/Paris', lastRunAt: null }

describe('nextRunAt', () => {
    it('reads the cron in its timezone', () => {
        expect(nextRunAt(RECURRING, NOW)).toBe('2026-10-01T07:00:00.000Z')
    })

    it('has no next run while paused', () => {
        expect(nextRunAt({ ...RECURRING, enabled: false }, NOW)).toBeNull()
    })

    it('returns the instant of a one-off that has not fired', () => {
        expect(nextRunAt({ ...RECURRING, cron: null, runAt: '2026-10-02T08:00:00.000Z' }, NOW)).toBe('2026-10-02T08:00:00.000Z')
    })

    it('has no next run once a one-off has fired', () => {
        expect(nextRunAt({ ...RECURRING, cron: null, runAt: '2026-09-29T08:00:00.000Z', lastRunAt: '2026-09-29T08:00:05.000Z' }, NOW)).toBeNull()
    })

    it('swallows an invalid expression', () => {
        expect(nextRunAt({ ...RECURRING, cron: 'not a cron' }, NOW)).toBeNull()
    })
})

describe('routineFrequency', () => {
    const cron = (expression: string) => routineFrequency({ cron: expression, runAt: null }, english)

    it('reads the daily, weekday, weekly and monthly shapes', () => {
        expect(cron('15 8 * * *')).toBe('Every day at 8:15 AM')
        expect(cron('15 12,16 * * *')).toBe('Every day at 12:15 PM, 4:15 PM')
        expect(cron('30 10 * * 1-5')).toBe('Weekdays at 10:30 AM')
        expect(cron('0 9 * * 1')).toBe('Every Monday at 9:00 AM')
        expect(cron('0 6 1 * *')).toBe('Monthly on day 1 at 6:00 AM')
        expect(cron('*/15 * * * *')).toBe('Every 15 minutes')
    })

    it('falls back to cronstrue for the other shapes', () => {
        expect(cron('0 9-17 * * *')).toBe('Every hour, between 09:00 AM and 05:00 PM')
        expect(cron('not a cron')).toBe('not a cron')
    })

    it('reads a one-off as its date', () => {
        expect(routineFrequency({ cron: null, runAt: '2026-10-24T11:00:00.000Z' }, english)).toMatch(/^Once, Oct 24, /)
    })
})

describe('in the reader\'s language', () => {
    it('reads the same shapes in French, cronstrue included', () => {
        const cron = (expression: string) => routineFrequency({ cron: expression, runAt: null }, french, 'fr')
        expect(cron('15 8 * * *')).toBe('Tous les jours à 8:15')
        expect(cron('0 9 * * 1')).toBe('Chaque lundi à 9:00')
        expect(cron('30 10 * * 1-5')).toBe('En semaine à 10:30')
        expect(cron('0 9-17 * * *')).toBe('Toutes les heures, de 09:00 à 17:00')
        expect(humanCron('0 9 * * *', 'es')).toBe('A las 09:00')
    })

    it('keeps cronstrue in English for a language without a pack', () => {
        expect(humanCron('0 9 * * *', 'en-XA')).toBe('At 09:00 AM')
    })
})

describe('scheduleSummary', () => {
    it('reads a cron with its timezone, and a one-off as its date', () => {
        expect(scheduleSummary({ cron: '0 9 * * *', runAt: null, timezone: 'Europe/Paris' }, english)).toBe('At 09:00 AM · Europe/Paris')
        expect(scheduleSummary({ cron: null, runAt: '2026-10-24T11:00:00.000Z', timezone: null }, english)).toMatch(/^once · /)
        expect(scheduleSummary({ cron: null, runAt: null, timezone: null }, english)).toBe('—')
    })
})
