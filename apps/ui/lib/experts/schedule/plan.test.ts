import { describe, expect, it } from 'vitest'

import { planInviteCampaign, type PlanParams, type PlannableExpert } from './plan'
import { DEFAULT_WINDOW, capDayKey, getLocalParts, isInLocalWindow, nextEligibleAt, zonedWallTimeToInstant } from './window'

const baseParams: PlanParams = {
    startAt: new Date('2026-01-05T00:00:00Z'),
    dailyCap: 40,
    minGapMinutes: 4,
    jitterMinutes: 3,
    seed: 'campaign-1',
}

function makeExperts(timezone: string, count: number, prefix = timezone): PlannableExpert[] {
    return Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, timezone }))
}

describe('window', () => {
    it('renders wall clock across a spring-forward transition', () => {
        expect(getLocalParts(new Date('2026-03-29T00:30:00Z'), 'Europe/Rome').hour).toBe(1)
        expect(getLocalParts(new Date('2026-03-29T01:30:00Z'), 'Europe/Rome').hour).toBe(3)
    })

    it('renders wall clock across a fall-back transition', () => {
        expect(getLocalParts(new Date('2026-10-25T00:30:00Z'), 'Europe/Rome').hour).toBe(2)
    })

    it('handles half-hour offsets', () => {
        const parts = getLocalParts(new Date('2026-07-28T06:00:00Z'), 'Asia/Kolkata')
        expect(parts.hour).toBe(11)
        expect(parts.minute).toBe(30)
    })

    it('round-trips a local wall time back to the same wall time', () => {
        for (const timezone of ['Europe/Rome', 'Asia/Kolkata', 'Pacific/Auckland', 'America/Los_Angeles', 'Asia/Kathmandu']) {
            const instant = zonedWallTimeToInstant(2026, 3, 30, 8, 0, timezone)
            const parts = getLocalParts(instant, timezone)
            expect(`${parts.hour}:${parts.minute}`, timezone).toBe('8:0')
        }
    })

    it('skips a spring-forward gap rather than returning a non-existent wall time', () => {
        const instant = zonedWallTimeToInstant(2026, 9, 6, 0, 0, 'America/Santiago')
        expect(getLocalParts(instant, 'America/Santiago').hour).toBe(1)
    })

    it('returns null when the window is empty', () => {
        expect(nextEligibleAt(new Date('2026-01-05T00:00:00Z'), 'Europe/Rome', { startHour: 8, endHour: 8, weekdays: [1] })).toBeNull()
        expect(nextEligibleAt(new Date('2026-01-05T00:00:00Z'), 'Europe/Rome', { startHour: 8, endHour: 18, weekdays: [] })).toBeNull()
    })
})

describe('planInviteCampaign', () => {
    it('never schedules outside the local window', () => {
        const experts = [
            ...makeExperts('Europe/Rome', 20),
            ...makeExperts('Asia/Tokyo', 20),
            ...makeExperts('America/Los_Angeles', 20),
            ...makeExperts('Asia/Kolkata', 20),
            ...makeExperts('Pacific/Auckland', 20),
        ]
        const { scheduled, unschedulable } = planInviteCampaign(experts, baseParams)

        expect(unschedulable).toEqual([])
        expect(scheduled).toHaveLength(experts.length)
        const timezones = new Map(experts.map(e => [e.id, e.timezone]))
        for (const { id, sendAt } of scheduled) {
            expect(isInLocalWindow(sendAt, timezones.get(id)!, DEFAULT_WINDOW), `${id} @ ${sendAt.toISOString()}`).toBe(true)
        }
    })

    it('never schedules on a weekend', () => {
        const experts = [...makeExperts('Europe/Rome', 30), ...makeExperts('Pacific/Auckland', 30)]
        const { scheduled } = planInviteCampaign(experts, { ...baseParams, startAt: new Date('2026-01-09T12:00:00Z') })
        const timezones = new Map(experts.map(e => [e.id, e.timezone]))
        for (const { id, sendAt } of scheduled) {
            expect(getLocalParts(sendAt, timezones.get(id)!).weekday).not.toBe(0)
            expect(getLocalParts(sendAt, timezones.get(id)!).weekday).not.toBe(6)
        }
    })

    it('keeps at least minGapMinutes between two consecutive sends', () => {
        const experts = [...makeExperts('Europe/Rome', 40), ...makeExperts('Asia/Tokyo', 40), ...makeExperts('America/New_York', 40)]
        const { scheduled } = planInviteCampaign(experts, baseParams)
        const times = scheduled.map(entry => entry.sendAt.getTime()).sort((a, b) => a - b)
        for (let i = 1; i < times.length; i++) {
            expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(baseParams.minGapMinutes * 60_000)
        }
    })

    it('never exceeds the daily cap', () => {
        const experts = [...makeExperts('Europe/Rome', 60), ...makeExperts('Asia/Tokyo', 60)]
        const { scheduled } = planInviteCampaign(experts, { ...baseParams, dailyCap: 25 })
        const perDay = new Map<string, number>()
        for (const { sendAt } of scheduled) {
            const key = capDayKey(sendAt, 'UTC')
            perDay.set(key, (perDay.get(key) ?? 0) + 1)
        }
        for (const count of perDay.values()) expect(count).toBeLessThanOrEqual(25)
    })

    it('drains a small timezone at the same pace as a large one', () => {
        const experts = [...makeExperts('Europe/Rome', 200), ...makeExperts('Asia/Tokyo', 20)]
        const { scheduled } = planInviteCampaign(experts, { ...baseParams, dailyCap: 30 })

        const firstDay = capDayKey(scheduled[0].sendAt, 'UTC')
        const sentFirstDay = scheduled.filter(entry => capDayKey(entry.sendAt, 'UTC') === firstDay)
        const romeFraction = sentFirstDay.filter(entry => entry.id.startsWith('Europe/Rome')).length / 200
        const tokyoFraction = sentFirstDay.filter(entry => entry.id.startsWith('Asia/Tokyo')).length / 20

        expect(Math.abs(romeFraction - tokyoFraction)).toBeLessThan(0.06)
    })

    it('does not let an eastern timezone swallow the daily cap', () => {
        const experts = [...makeExperts('Asia/Tokyo', 200), ...makeExperts('Europe/Rome', 200)]
        const { scheduled } = planInviteCampaign(experts, { ...baseParams, dailyCap: 30 })

        const firstDay = capDayKey(scheduled[0].sendAt, 'UTC')
        const sentFirstDay = scheduled.filter(entry => capDayKey(entry.sendAt, 'UTC') === firstDay)
        expect(sentFirstDay.filter(entry => entry.id.startsWith('Asia/Tokyo')).length).toBeGreaterThan(10)
        expect(sentFirstDay.filter(entry => entry.id.startsWith('Europe/Rome')).length).toBeGreaterThan(10)
    })

    it('fills the daily cap instead of idling while it waits for a zone to open', () => {
        const experts = [
            ...makeExperts('Europe/Paris', 12),
            ...makeExperts('Europe/London', 6),
            ...makeExperts('America/New_York', 9),
            ...makeExperts('America/Los_Angeles', 5),
            ...makeExperts('Asia/Kolkata', 7),
            ...makeExperts('Asia/Tokyo', 3),
            ...makeExperts('Australia/Sydney', 2),
            ...makeExperts('America/Sao_Paulo', 3),
            ...makeExperts('Africa/Lagos', 3),
        ]
        const { scheduled } = planInviteCampaign(experts, {
            ...baseParams,
            startAt: new Date('2026-07-28T07:00:00Z'),
            dailyCap: 20,
            minGapMinutes: 6,
        })

        const perDay = new Map<string, number>()
        for (const { sendAt } of scheduled) {
            const key = capDayKey(sendAt, 'UTC')
            perDay.set(key, (perDay.get(key) ?? 0) + 1)
        }
        expect(perDay.size).toBeLessThanOrEqual(3)
        expect(Math.max(...perDay.values())).toBeLessThanOrEqual(20)
    })

    it('reports experts it cannot fit before the horizon', () => {
        const experts = makeExperts('Europe/Rome', 200)
        const { scheduled, unschedulable } = planInviteCampaign(experts, { ...baseParams, dailyCap: 2, maxHorizonDays: 10 })

        expect(scheduled.length).toBeLessThan(experts.length)
        expect(unschedulable.length).toBe(experts.length - scheduled.length)
        expect(unschedulable.every(entry => entry.reason === 'horizon-exceeded')).toBe(true)
    })

    it('rejects invalid timezones without dropping the rest', () => {
        const experts = [...makeExperts('Europe/Rome', 3), { id: 'broken', timezone: 'Not/AZone' }]
        const { scheduled, unschedulable } = planInviteCampaign(experts, baseParams)

        expect(scheduled).toHaveLength(3)
        expect(unschedulable).toEqual([{ id: 'broken', reason: 'invalid-timezone' }])
    })

    it('is deterministic for a given seed', () => {
        const experts = [...makeExperts('Europe/Rome', 30), ...makeExperts('Asia/Tokyo', 30)]
        const a = planInviteCampaign(experts, baseParams)
        const b = planInviteCampaign(experts, baseParams)
        expect(serialize(a.scheduled)).toEqual(serialize(b.scheduled))

        const c = planInviteCampaign(experts, { ...baseParams, seed: 'campaign-2' })
        expect(serialize(c.scheduled)).not.toEqual(serialize(a.scheduled))
    })

    it('keeps a plan stable when one expert is removed', () => {
        const experts = makeExperts('Europe/Rome', 20)
        const full = planInviteCampaign(experts, baseParams)
        const without = planInviteCampaign(experts.slice(1), baseParams)

        const fullById = new Map(full.scheduled.map(entry => [entry.id, entry.sendAt.getTime()]))
        const unchanged = without.scheduled.filter(entry => fullById.get(entry.id) === entry.sendAt.getTime())
        expect(unchanged.length).toBeGreaterThan(0)
    })

    it('schedules a campaign that straddles a DST transition inside the window', () => {
        const experts = makeExperts('Europe/Rome', 60)
        const { scheduled } = planInviteCampaign(experts, {
            ...baseParams,
            startAt: new Date('2026-03-27T09:00:00Z'),
            dailyCap: 10,
        })
        for (const { sendAt } of scheduled) {
            expect(isInLocalWindow(sendAt, 'Europe/Rome', DEFAULT_WINDOW), sendAt.toISOString()).toBe(true)
        }
    })
})

function serialize(entries: { id: string; sendAt: Date }[]): string {
    return entries.map(entry => `${entry.id}@${entry.sendAt.toISOString()}`).join('|')
}
