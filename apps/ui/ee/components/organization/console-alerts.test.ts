import { MICROS_PER_CREDIT } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { alertOf, byRunway, countAlerts, runwayDays } from './console-alerts'
import type { ConsoleWorkspace } from './types'

const workspace = (overrides: Partial<ConsoleWorkspace> = {}): ConsoleWorkspace => ({ id: 1, name: 'Acme', iconUrl: null, status: 'active', memberCount: 1, coworkerCount: 0, coworkers: [], pendingAdmin: null, creditMicros: 100 * MICROS_PER_CREDIT, spentPerDayMicros: 0, machine: 'running', diskPercent: null, lastActivityAt: null, ...overrides })
const perDay = (credits: number) => credits * MICROS_PER_CREDIT
const pendingAdmin = { invitationId: 'i', email: 'lea@acme.test', expired: false }

describe('runwayDays', () => {
    it.each([
        [100, 10, 10],
        [105, 10, 10],
        [5, 10, 0],
        [0, 10, 0],
        [-5, 10, 0],
        [100, 0, null],
    ])('%i credits at %i a day last %s days', (credits, spent, days) => {
        expect(runwayDays({ creditMicros: perDay(credits), spentPerDayMicros: perDay(spent) })).toBe(days)
    })
})

describe('alertOf', () => {
    it.each([
        ['nothing', {}, null],
        ['no credit', { status: 'outOfCredit', creditMicros: 0 }, 'outOfCredit'],
        ['a full disk', { diskPercent: 90 }, 'disk'],
        ['a disk that has room', { diskPercent: 89 }, null],
        ['a machine in error', { machine: 'error' }, 'machine'],
        ['an admin who has not come', { status: 'provisioning', pendingAdmin }, 'invite'],
        ['thirteen days of credit', { spentPerDayMicros: perDay(7.2) }, 'lowCredit'],
        ['fourteen days of credit', { spentPerDayMicros: perDay(7.1) }, null],
        ['an archived one, whatever it lacks', { status: 'archived', machine: 'archived', creditMicros: 0, pendingAdmin, diskPercent: 99 }, null],
        ['one that failed to come back', { status: 'archived', machine: 'error' }, 'machine'],
        ['no credit and a full disk', { status: 'outOfCredit', diskPercent: 95 }, 'outOfCredit'],
    ] as [string, Partial<ConsoleWorkspace>, string | null][])('%s', (_, overrides, kind) => {
        expect(alertOf(workspace(overrides))?.kind ?? null).toBe(kind)
    })

    it('are counted', () => {
        expect(countAlerts([workspace(), workspace({ diskPercent: 95 }), workspace({ status: 'outOfCredit' })])).toBe(2)
    })
})

describe('byRunway', () => {
    it('keeps the order of the ones that tie', () => {
        expect(byRunway([workspace({ id: 1 }), workspace({ id: 2, status: 'outOfCredit', creditMicros: 0 }), workspace({ id: 3 }), workspace({ id: 4, status: 'archiving' })]).map(({ id }) => id)).toEqual([2, 1, 3])
    })
})
