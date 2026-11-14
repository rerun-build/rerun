import { describe, expect, it } from 'vitest'
import { openTrialSlot, pickTrialMessage, type TrialSignals, type TrialSlot } from './trial-sequence-decide'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

const START = new Date('2026-10-10T14:00:00.000Z')
const TRIAL_ENDS_AT = new Date(START.getTime() + 5 * DAY)
const EXTENDED_ENDS_AT = new Date(START.getTime() + 8 * DAY)

const at = (hours: number) => new Date(START.getTime() + hours * HOUR)
const slotOf = (day: number, lastDay = 4): TrialSlot => ({ day, startedAt: START, lastDay })
const nowOf = (day: number) => at(day === 0 ? 3.5 : day * 24 + 0.5)

function signals(overrides: Partial<TrialSignals> = {}): TrialSignals {
    return {
        cancelled: false,
        repliedAt: null,
        lastWhatsAppAt: null,
        askedForOk: false,
        recapSent: false,
        doneRuns: [],
        chats: [],
        hasSchedule: false,
        waitingOnThem: false,
        ...overrides,
    }
}

const pick = (day: number, overrides: Partial<TrialSignals> = {}) => pickTrialMessage(signals(overrides), slotOf(day), nowOf(day))
const pickExtended = (day: number, overrides: Partial<TrialSignals> = {}) => pickTrialMessage(signals(overrides), slotOf(day, 7), nowOf(day))

const TWO_JOBS = { doneRuns: [{ at: at(1), scheduled: false }, { at: at(30), scheduled: true }] }

describe('openTrialSlot', () => {
    it('opens day 0 three hours after the signup, and every other day at the signup hour', () => {
        expect(openTrialSlot(START, TRIAL_ENDS_AT, at(2.9))).toBeNull()
        expect(openTrialSlot(START, TRIAL_ENDS_AT, at(3))).toEqual({ day: 0, startedAt: START, lastDay: 4 })
        expect(openTrialSlot(START, TRIAL_ENDS_AT, at(23.9))).toBeNull()
        expect(openTrialSlot(START, TRIAL_ENDS_AT, at(24))).toEqual({ day: 1, startedAt: START, lastDay: 4 })
        expect(openTrialSlot(START, TRIAL_ENDS_AT, at(4 * 24 + 1))).toEqual({ day: 4, startedAt: START, lastDay: 4 })
    })

    it('drops a slot missed by six hours, and has nothing past the trial', () => {
        expect(openTrialSlot(START, TRIAL_ENDS_AT, at(24 + 5.9))?.day).toBe(1)
        expect(openTrialSlot(START, TRIAL_ENDS_AT, at(24 + 6))).toBeNull()
        expect(openTrialSlot(START, TRIAL_ENDS_AT, at(5 * 24 + 1))).toBeNull()
        expect(openTrialSlot(START, TRIAL_ENDS_AT, at(-1))).toBeNull()
    })

    it('keeps counting from the signup on an extended trial, and ends with it', () => {
        expect(openTrialSlot(START, EXTENDED_ENDS_AT, at(4 * 24 + 1))).toEqual({ day: 4, startedAt: START, lastDay: 7 })
        expect(openTrialSlot(START, EXTENDED_ENDS_AT, at(7 * 24 + 1))).toEqual({ day: 7, startedAt: START, lastDay: 7 })
        expect(openTrialSlot(START, EXTENDED_ENDS_AT, at(8 * 24 + 1))).toBeNull()
    })
})

describe('pickTrialMessage', () => {
    it('day 0: celebrates a first job done, unless it already runs on a schedule', () => {
        expect(pick(0, { doneRuns: [{ at: at(1), scheduled: false }] })).toEqual({ key: 'trial_first_job_done', day: 0 })
        expect(pick(0, { doneRuns: [{ at: at(1), scheduled: false }], hasSchedule: true })).toEqual({ skip: 'nothing_to_say' })
        expect(pick(0)).toEqual({ skip: 'nothing_to_say' })
    })

    it('day 1: the morning report after a scheduled run, the nudge to someone who never gave a job', () => {
        expect(pick(1, { doneRuns: [{ at: at(20), scheduled: true }] })).toEqual({ key: 'trial_morning_report', day: 1 })
        expect(pick(1)).toEqual({ key: 'trial_no_first_job', day: 1 })
        expect(pick(1, { doneRuns: [{ at: at(1), scheduled: false }] })).toEqual({ skip: 'nothing_to_say' })
    })

    it('day 2: an idea for someone who worked on day 0 and went quiet', () => {
        const workedDayZero = { doneRuns: [{ at: at(1), scheduled: false }] }
        expect(pick(2, workedDayZero)).toEqual({ key: 'trial_idea_for_you', day: 2 })
        expect(pick(2, { ...workedDayZero, chats: [at(30)] })).toEqual({ skip: 'nothing_to_say' })
        expect(pick(2)).toEqual({ skip: 'nothing_to_say' })
    })

    it('day 3: asks what is in the way of someone not seen since day 1', () => {
        expect(pick(3, { chats: [at(30)] })).toEqual({ key: 'trial_anything_blocking', day: 3 })
        expect(pick(3)).toEqual({ key: 'trial_anything_blocking', day: 3 })
        expect(pick(3, { chats: [at(50)] })).toEqual({ skip: 'nothing_to_say' })
    })

    it('last day: the week recap from two jobs done, and leaves a cancelled trial to the access-ending notice', () => {
        expect(pick(4, TWO_JOBS)).toEqual({ key: 'trial_week_recap', day: 4 })
        expect(pick(4, { doneRuns: [{ at: at(1), scheduled: false }] })).toEqual({ skip: 'nothing_to_say' })
        expect(pick(4, { ...TWO_JOBS, cancelled: true })).toEqual({ skip: 'access_ending' })
    })

    it('an extended trial says nothing between day 3 and its last day, then recaps once', () => {
        expect(pickExtended(4, TWO_JOBS)).toEqual({ skip: 'nothing_to_say' })
        expect(pickExtended(4, { ...TWO_JOBS, cancelled: true })).toEqual({ skip: 'nothing_to_say' })
        expect(pickExtended(5, TWO_JOBS)).toEqual({ skip: 'nothing_to_say' })
        expect(pickExtended(6, TWO_JOBS)).toEqual({ skip: 'nothing_to_say' })
        expect(pickExtended(7, TWO_JOBS)).toEqual({ key: 'trial_week_recap', day: 7 })
        expect(pickExtended(7, { ...TWO_JOBS, cancelled: true })).toEqual({ skip: 'access_ending' })
        expect(pickExtended(7, { ...TWO_JOBS, recapSent: true })).toEqual({ skip: 'nothing_to_say' })
    })

    it('a coworker waiting on them takes the day’s place, once per trial', () => {
        expect(pick(1, { waitingOnThem: true })).toEqual({ key: 'trial_needs_your_ok', day: 1 })
        expect(pick(1, { waitingOnThem: true, askedForOk: true })).toEqual({ key: 'trial_no_first_job', day: 1 })
    })

    it('stops for someone who replied, and never sends twice within the same day', () => {
        expect(pick(1, { repliedAt: at(10) })).toEqual({ skip: 'replied' })
        expect(pick(1, { repliedAt: at(-48) })).toEqual({ key: 'trial_no_first_job', day: 1 })
        expect(pick(1, { lastWhatsAppAt: at(10) })).toEqual({ skip: 'daily_cap' })
        expect(pick(1, { lastWhatsAppAt: at(3.5) })).toEqual({ key: 'trial_no_first_job', day: 1 })
    })
})
