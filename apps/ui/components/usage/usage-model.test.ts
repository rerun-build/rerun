import { describe, expect, it } from 'vitest'
import { DAY, HOUR, NOT_RECORDED, readableModelId, autoGranularity, bucketStarts, bucketize, granularitiesFor, groupRows, loadWindow, matches, presetPeriod, previousPeriod, rangePeriod, reachesNow, spendOf, splitModelKey, toUsageRow, totalsOf, usageCsv, EMPTY_FILTER_VALUES, type UsageRow } from './usage-model'
import type { WorkspaceUsageRun } from '@/app/api/_services/usage.service'

const NOW = new Date(2026, 10, 26, 14, 20).getTime()

function row(patch: Partial<WorkspaceUsageRun> = {}): UsageRow {
    return toUsageRow({
        id: 'r',
        coworkerId: 'nova',
        status: 'done',
        startedAt: new Date(NOW - HOUR).toISOString(),
        finishedAt: null,
        provider: 'rerun',
        model: 'anthropic/claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 100,
        costMicros: 20_000,
        starterKind: 'person',
        starterId: 'u1',
        starterName: 'Noa',
        ...patch,
    })
}

describe('totals', () => {
    it('counts the tokens of a run it cannot price and leaves its cost out', () => {
        const totals = totalsOf([row(), row({ costMicros: null }), row({ costMicros: null, status: 'running' }), row({ starterKind: null, starterId: null })])
        expect(totals).toMatchObject({ runs: 4, input: 4000, output: 400, cost: 40_000, unpriced: 1, unattributed: 1, running: 1 })
    })

    it('never prices a group with only running runs', () => {
        expect(groupRows([row({ status: 'running', costMicros: null })], 'model')[0]).toMatchObject({ priced: false, unpriced: 0 })
    })

    it('marks a group unpriced only when nothing in it has a price', () => {
        const groups = groupRows([row({ model: 'claude', costMicros: null }), row({ model: 'sonnet' }), row({ model: 'sonnet', costMicros: null })], 'model')
        expect(groups.map(g => [g.key, g.priced, g.runs])).toEqual([
            ['sonnet', true, 2],
            ['claude', false, 1],
        ])
    })

    it('splits a model on a subscription from the same model on a key', () => {
        const groups = groupRows([row({ model: 'claude-sonnet-4-6', provider: 'claude', costMicros: null }), row({ model: 'claude-sonnet-4-6', provider: 'anthropic' }), row({ model: 'claude-sonnet-4-6', provider: 'openrouter' })], 'model')
        expect(groups.map(g => [g.key, g.runs])).toEqual([
            ['claude-sonnet-4-6', 2],
            ['claude-sonnet-4-6::subscription', 1],
        ])
        expect(splitModelKey(groups[1].key)).toEqual({ model: 'claude-sonnet-4-6', subscription: true })
    })

    it('puts every calling coworker under one row, and every person under their own', () => {
        const groups = groupRows([row({ starterKind: 'coworker', starterId: 'atlas' }), row({ starterKind: 'coworker', starterId: 'echo' }), row(), row({ starterId: 'u2' }), row({ starterKind: null, starterId: null })], 'starter')
        expect(groups.map(g => g.key).sort()).toEqual(['coworker', NOT_RECORDED, 'person:u1', 'person:u2'].sort())
    })
})

describe('filters', () => {
    it('keeps a running run out of both cost filters', () => {
        const running = row({ status: 'running', costMicros: null })
        expect(matches(running, { ...EMPTY_FILTER_VALUES, pricing: ['unpriced'] })).toBe(false)
        expect(matches(running, { ...EMPTY_FILTER_VALUES, pricing: ['priced'] })).toBe(false)
        expect(matches(row({ costMicros: null }), { ...EMPTY_FILTER_VALUES, pricing: ['unpriced'] })).toBe(true)
    })

    it('combines the dimensions', () => {
        const values = { ...EMPTY_FILTER_VALUES, coworkers: ['nova'], starters: ['person:u1'] }
        expect(matches(row(), values)).toBe(true)
        expect(matches(row({ starterId: 'u2' }), values)).toBe(false)
    })
})

describe('periods', () => {
    it('starts today at local midnight and the month on its first day', () => {
        expect(new Date(presetPeriod('today', NOW).from).getHours()).toBe(0)
        expect(new Date(presetPeriod('mtd', NOW).from).getDate()).toBe(1)
        expect(presetPeriod('30d', NOW).to - presetPeriod('30d', NOW).from).toBe(30 * DAY)
    })

    it('covers both picked days whole', () => {
        const period = rangePeriod(new Date(2026, 10, 20), new Date(2026, 10, 26))
        expect(new Date(period.from).getDate()).toBe(20)
        expect(period.to).toBe(new Date(2026, 10, 27).getTime() - 1)
        expect(reachesNow(period, NOW)).toBe(true)
        expect(reachesNow(rangePeriod(new Date(2026, 9, 1), new Date(2026, 9, 7)), NOW)).toBe(false)
    })

    it('reads a past range up to its end, and a preset up to now', () => {
        const past = rangePeriod(new Date(2026, 9, 1), new Date(2026, 9, 7))
        expect(loadWindow(null, past, NOW)).toEqual({ from: previousPeriod(past).from, to: past.to })
        expect(loadWindow('7d', null, NOW)).toEqual({ from: NOW - 14 * DAY, to: null })
    })

    it('reads Today and Month to date early enough for the period before them as the clock runs', () => {
        const today = presetPeriod('today', NOW)
        expect(loadWindow('today', null, NOW).from).toBe(today.from - DAY)
        const later = presetPeriod('today', NOW + 8 * HOUR)
        expect(previousPeriod(later).from).toBeGreaterThanOrEqual(loadWindow('today', null, NOW).from)
        expect(loadWindow('mtd', null, NOW).from).toBe(presetPeriod('mtd', NOW).from - 31 * DAY)
    })

    it('compares with the window of the same length just before', () => {
        const period = presetPeriod('7d', NOW)
        expect(previousPeriod(period)).toEqual({ preset: null, from: period.from - 7 * DAY, to: period.from })
    })
})

describe('chart buckets', () => {
    it('picks hours, days or weeks from the length of the period', () => {
        expect(autoGranularity(presetPeriod('today', NOW))).toBe('hour')
        expect(autoGranularity(presetPeriod('30d', NOW))).toBe('day')
        expect(autoGranularity(presetPeriod('90d', NOW))).toBe('week')
    })

    it('offers hours only up to two weeks', () => {
        expect(granularitiesFor(presetPeriod('7d', NOW))).toEqual(['hour', 'day', 'week'])
        expect(granularitiesFor(presetPeriod('90d', NOW))).toEqual(['day', 'week'])
        expect(granularitiesFor(presetPeriod('90d', NOW))).toContain(autoGranularity(presetPeriod('90d', NOW)))
    })

    it('starts the hourly bars on a whole local hour', () => {
        const starts = bucketStarts({ preset: null, from: new Date(2026, 10, 26, 9, 40).getTime(), to: NOW }, 'hour')
        expect(new Date(starts[0]).getHours()).toBe(9)
        expect(new Date(starts[0]).getMinutes()).toBe(0)
        expect(starts).toHaveLength(6)
    })

    it('ends on today and sums each run into its day, per series', () => {
        const period = presetPeriod('7d', NOW)
        const starts = bucketStarts(period, 'day')
        expect(starts).toHaveLength(8)
        const buckets = bucketize([row(), row({ model: 'gpt' }), row({ startedAt: new Date(NOW - 2 * DAY).toISOString() })], starts, 'day', r => r.model, spendOf)
        expect(buckets.at(-1)?.total).toBe(40_000)
        expect(buckets.at(-1)?.bySeries.get('gpt')).toBe(20_000)
        expect(buckets.at(-3)?.total).toBe(20_000)
    })
})

describe('csv', () => {
    it('leaves the cost of an unpriced run empty and quotes what needs it', () => {
        const csv = usageCsv([row({ costMicros: null })], { coworker: () => 'Nova, sales', starter: () => 'Noa', model: () => 'Claude' })
        const [header, line] = csv.split('\n')
        expect(header).toBe('started_at,status,coworker,started_by,model,provider,input_tokens,output_tokens,cost_usd')
        expect(line.endsWith(',1000,100,')).toBe(true)
        expect(line).toContain('"Nova, sales"')
    })

    it('reads a name a spreadsheet would run as a formula as text', () => {
        const line = usageCsv([row()], { coworker: () => '=HYPERLINK("x")', starter: () => '@Noa', model: () => 'Claude' }).split('\n')[1]
        expect(line).toContain(`"'=HYPERLINK(""x"")"`)
        expect(line).toContain(",'@Noa,")
    })
})

describe('readableModelId', () => {
    it('reads a model the catalog does not name', () => {
        expect(readableModelId('anthropic/claude-sonnet-4.5')).toBe('Claude Sonnet 4.5')
        expect(readableModelId('claude-sonnet-4-5')).toBe('Claude Sonnet 4.5')
        expect(readableModelId('openai/gpt-5.1')).toBe('GPT-5.1')
        expect(readableModelId('openai/gpt-5.1-mini')).toBe('GPT-5.1 Mini')
        expect(readableModelId('llama-3.3-70b')).toBe('Llama 3.3 70B')
        expect(readableModelId('z-ai/glm-4.6')).toBe('GLM-4.6')
    })
})
