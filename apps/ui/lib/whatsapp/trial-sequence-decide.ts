const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

const DAY_ZERO_DELAY_MS = 3 * HOUR_MS
const SLOT_WINDOW_MS = 6 * HOUR_MS
const DAILY_CAP_MS = 20 * HOUR_MS
const RECAP_MIN_TASKS = 2

export type TrialMessageKey =
    | 'trial_first_job_done'
    | 'trial_morning_report'
    | 'trial_no_first_job'
    | 'trial_idea_for_you'
    | 'trial_anything_blocking'
    | 'trial_needs_your_ok'
    | 'trial_week_recap'

export type TrialRun = { at: Date; scheduled: boolean }

export type TrialSignals = {
    cancelled: boolean
    repliedAt: Date | null
    lastWhatsAppAt: Date | null
    askedForOk: boolean
    recapSent: boolean
    doneRuns: TrialRun[]
    chats: Date[]
    hasSchedule: boolean
    waitingOnThem: boolean
}

export type TrialSlot = { day: number; startedAt: Date; lastDay: number }
export type TrialPick = { key: TrialMessageKey; day: number } | { skip: string }

function slotAt(start: Date, day: number): number {
    return start.getTime() + (day === 0 ? DAY_ZERO_DELAY_MS : day * DAY_MS)
}

export function openTrialSlot(startedAt: Date, endsAt: Date, now: Date): TrialSlot | null {
    const day = Math.floor((now.getTime() - startedAt.getTime()) / DAY_MS)
    const lastDay = Math.round((endsAt.getTime() - startedAt.getTime()) / DAY_MS) - 1
    if (day < 0 || day > lastDay) return null
    const opensAt = slotAt(startedAt, day)
    if (now.getTime() < opensAt || now.getTime() >= opensAt + SLOT_WINDOW_MS) return null
    return { day, startedAt, lastDay }
}

function dayStart(start: Date, day: number): number {
    return start.getTime() + day * DAY_MS
}

function plannedMessage(signals: TrialSignals, slot: TrialSlot): TrialMessageKey | null {
    const chattedSince = (from: number) => signals.chats.some(at => at.getTime() >= from)

    if (slot.day === slot.lastDay) return signals.doneRuns.length >= RECAP_MIN_TASKS && !signals.recapSent ? 'trial_week_recap' : null

    switch (slot.day) {
        case 0:
            return signals.doneRuns.length > 0 && !signals.hasSchedule ? 'trial_first_job_done' : null
        case 1:
            if (signals.doneRuns.some(run => run.scheduled)) return 'trial_morning_report'
            return signals.doneRuns.length === 0 ? 'trial_no_first_job' : null
        case 2: {
            const workedOnDayZero = signals.doneRuns.some(run => run.at.getTime() < dayStart(slot.startedAt, 1))
            return workedOnDayZero && !chattedSince(dayStart(slot.startedAt, 1)) ? 'trial_idea_for_you' : null
        }
        case 3:
            return chattedSince(dayStart(slot.startedAt, 2)) ? null : 'trial_anything_blocking'
        default:
            return null
    }
}

export function pickTrialMessage(signals: TrialSignals, slot: TrialSlot, now: Date): TrialPick {
    if (signals.repliedAt && signals.repliedAt >= slot.startedAt) return { skip: 'replied' }
    if (signals.lastWhatsAppAt && now.getTime() - signals.lastWhatsAppAt.getTime() < DAILY_CAP_MS) return { skip: 'daily_cap' }
    if (slot.day === slot.lastDay && signals.cancelled) return { skip: 'access_ending' }

    if (signals.waitingOnThem && !signals.askedForOk) return { key: 'trial_needs_your_ok', day: slot.day }

    const key = plannedMessage(signals, slot)
    return key ? { key, day: slot.day } : { skip: 'nothing_to_say' }
}
