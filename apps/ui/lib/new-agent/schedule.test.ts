import { describe, expect, it } from 'vitest'

import { buildKickoff, DEFAULT_CUSTOM, DESCRIBED, type ScheduleChoice, scheduleLabel, toggleDay } from '@moldwright/ui/new-agent/schedule'

const JOB = 'Sort every Lemlist reply and ping me in Slack'

describe('buildKickoff', () => {
    it('sends the description as typed when the planner was left alone', () => {
        expect(buildKickoff(`  ${JOB}\n`, DESCRIBED, 'Europe/Paris')).toBe(JOB)
    })

    it('adds the preset as an instruction, in the user time zone', () => {
        expect(buildKickoff(JOB, { kind: 'preset', id: 'weekday' }, 'Europe/Paris')).toBe(`${JOB}\n\nRun this every weekday at 9:00 (Europe/Paris time). Set up the schedule yourself.`)
    })

    it('leaves the time zone out when it is not known', () => {
        expect(buildKickoff(JOB, { kind: 'preset', id: 'monday' }, null)).toBe(`${JOB}\n\nRun this every Monday at 9:00. Set up the schedule yourself.`)
    })

    it('words a custom week by its days', () => {
        const days = [true, false, true, false, false, true, false]
        expect(buildKickoff(JOB, { kind: 'custom', days, time: '14:30' }, null)).toContain('Run this every Monday, Wednesday and Saturday at 14:30.')
    })

    it('tells the agent not to schedule anything when it runs on demand', () => {
        expect(buildKickoff(JOB, { kind: 'on-demand' }, 'Europe/Paris')).toBe(`${JOB}\n\nDo not set up any schedule: only run this when I ask.`)
    })
})

describe('scheduleLabel', () => {
    it('has no words of its own for a timing left to the description', () => {
        expect(scheduleLabel(DESCRIBED)).toBeNull()
    })

    const SAID: [ScheduleChoice, string][] = [
        [DEFAULT_CUSTOM, 'Every weekday at 9:00'],
        [{ kind: 'custom', days: [true, true, true, true, true, true, true], time: '07:05' }, 'Every day at 7:05'],
        [{ kind: 'custom', days: [false, false, false, false, true, false, false], time: '18:00' }, 'Every Friday at 18:00'],
        [{ kind: 'preset', id: 'monday' }, 'Every Monday at 9:00'],
        [{ kind: 'on-demand' }, 'Only when I ask'],
    ]

    it.each(SAID)('says %j as %s', (choice, label) => {
        expect(scheduleLabel(choice)).toBe(label)
    })
})

describe('toggleDay', () => {
    it('turns a day on or off', () => {
        expect(toggleDay([true, false], 1)).toEqual([true, true])
        expect(toggleDay([true, true], 0)).toEqual([false, true])
    })

    it('keeps the last day on', () => {
        expect(toggleDay([false, true], 1)).toEqual([false, true])
    })
})
