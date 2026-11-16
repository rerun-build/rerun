import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { getSystemDb } from '../db/systemDb.js'
import { newId } from '../lib/ids.js'

// When the Chief of Staff wakes on its own, kept in its `system_meta` (a key-value table its
// `system.db` has had since step 4 of SYSTEM_DB_MIGRATIONS, so no new step): the wakes it planned, the
// last one, how many today, and a short log. One JSON value, written whole.

const STATE_KEY = 'foreman.wakes'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
export const MIN_LEAD_MS = 15 * MINUTE_MS
const MAX_LEAD_MS = 7 * 24 * HOUR_MS
// The wake it gets when it planned none: a day after the last one, moved out of the quiet hours.
export const MANDATORY_AFTER_MS = 24 * HOUR_MS
export const MAX_PLANNED = 5
export const DAILY_CAP = 12
const LOG_SIZE = 30
// The member's night: no wake starts between 20:00 and 08:00 in their time zone.
const QUIET_FROM_HOUR = 20
const QUIET_UNTIL_HOUR = 8

export type PlannedWake = { id: string; at: string; reason: string }

export type WakeLogEntry = { at: string; reason: string; outcome: string; sessionId?: string }

export type WakeState = {
    planned: PlannedWake[]
    // The last wake that started, or was consumed by a run that failed to start.
    last: string | null
    // Wakes started on `date`, a day of the member's calendar.
    day: { date: string; count: number }
    timezone: string | null
    // Set after the hub said no or could not be reached: nothing is asked before then.
    retryAt: string | null
    backoffMs: number
    log: WakeLogEntry[]
}

export const EMPTY_WAKE_STATE: WakeState = { planned: [], last: null, day: { date: '', count: 0 }, timezone: null, retryAt: null, backoffMs: 0, log: [] }

export async function readWakeState(): Promise<WakeState> {
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    const rs = await client.execute({ sql: 'SELECT value FROM system_meta WHERE key = ?', args: [STATE_KEY] })
    const raw = rs.rows[0]?.value
    if (typeof raw !== 'string') return { ...EMPTY_WAKE_STATE }
    try {
        return { ...EMPTY_WAKE_STATE, ...(JSON.parse(raw) as Partial<WakeState>) }
    } catch {
        return { ...EMPTY_WAKE_STATE }
    }
}

export async function writeWakeState(state: WakeState): Promise<void> {
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    await client.execute({ sql: 'INSERT OR REPLACE INTO system_meta (key, value) VALUES (?, ?)', args: [STATE_KEY, JSON.stringify(state)] })
}

let writes: Promise<unknown> = Promise.resolve()

// Read, change, write, one after the other: a tool call and the runner's tick may land together.
export function updateWakeState<T>(change: (state: WakeState) => T): Promise<T> {
    const next = writes.then(async () => {
        const state = await readWakeState()
        const result = change(state)
        await writeWakeState(state)
        return result
    })
    writes = next.catch(() => {})
    return next
}

function zone(timezone: string | null): string {
    if (!timezone) return 'UTC'
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone })
        return timezone
    } catch {
        return 'UTC'
    }
}

function localParts(date: Date, timezone: string | null): { date: string; hour: number; minute: number } {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone(timezone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]))
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) }
}

export function localDay(date: Date, timezone: string | null): string {
    return localParts(date, timezone).date
}

export function isQuiet(date: Date, timezone: string | null): boolean {
    const { hour } = localParts(date, timezone)
    return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR
}

// The first moment from `date` on that is not in the member's night, to the quarter hour. Walked
// rather than computed, so a change of clock in the night lands on the right morning.
export function outOfQuietHours(date: Date, timezone: string | null): Date {
    let at = new Date(date)
    for (let step = 0; step < 4 * 14 && isQuiet(at, timezone); step++) {
        const { minute } = localParts(at, timezone)
        at = new Date(at.getTime() + (15 - (minute % 15)) * MINUTE_MS)
        at.setUTCSeconds(0, 0)
    }
    return at
}

export type WakeSlot = { at: Date; moved: Array<'too_soon' | 'too_far' | 'quiet_hours'> }

// Where a wake the Chief of Staff asks for really lands: not sooner than fifteen minutes, not later
// than a week, never in the member's night.
export function placeWake(requested: Date, now: Date, timezone: string | null): WakeSlot {
    const moved: WakeSlot['moved'] = []
    let at = requested
    if (at.getTime() < now.getTime() + MIN_LEAD_MS) {
        at = new Date(now.getTime() + MIN_LEAD_MS)
        moved.push('too_soon')
    }
    if (at.getTime() > now.getTime() + MAX_LEAD_MS) {
        at = new Date(now.getTime() + MAX_LEAD_MS)
        moved.push('too_far')
    }
    const awake = outOfQuietHours(at, timezone)
    if (awake.getTime() !== at.getTime()) moved.push('quiet_hours')
    return { at: awake, moved }
}

export function mandatoryWakeAt(state: WakeState, now: Date): Date {
    if (!state.last) return outOfQuietHours(now, state.timezone)
    return outOfQuietHours(new Date(Date.parse(state.last) + MANDATORY_AFTER_MS), state.timezone)
}

export type DueWake = { reason: string; plannedId?: string }

// What wakes it now, if anything: the earliest planned wake that came, else the mandatory one.
export function dueWake(state: WakeState, now: Date): DueWake | null {
    const planned = state.planned.filter(wake => Date.parse(wake.at) <= now.getTime()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0]
    if (planned) return { reason: planned.reason, plannedId: planned.id }
    if (mandatoryWakeAt(state, now).getTime() <= now.getTime()) return { reason: state.last ? 'Your daily check-in: you planned nothing since your last wake.' : 'Your first check-in on this workspace.' }
    return null
}

export function wakesToday(state: WakeState, now: Date): number {
    return state.day.date === localDay(now, state.timezone) ? state.day.count : 0
}

export function planWake(state: WakeState, requested: Date, reason: string, now: Date): { wake: PlannedWake; moved: WakeSlot['moved'] } | { error: string } {
    if (state.planned.length >= MAX_PLANNED) return { error: `You already have ${MAX_PLANNED} wakes planned: cancel one with cancel_wake first.` }
    const slot = placeWake(requested, now, state.timezone)
    const wake = { id: newId(), at: slot.at.toISOString(), reason: reason.trim().slice(0, 300) }
    state.planned.push(wake)
    return { wake, moved: slot.moved }
}

// The wake starts, or was consumed by a run that failed to: either way it is spent, so a run that
// keeps failing never wakes it again on every tick.
export function markWake(state: WakeState, due: DueWake, now: Date): void {
    state.last = now.toISOString()
    const today = localDay(now, state.timezone)
    state.day = { date: today, count: (state.day.date === today ? state.day.count : 0) + 1 }
    if (due.plannedId) state.planned = state.planned.filter(wake => wake.id !== due.plannedId)
}

export function logWake(state: WakeState, entry: WakeLogEntry): void {
    state.log = [...state.log, entry].slice(-LOG_SIZE)
}

// A data-dir restored from an archive weeks later: the wakes whose moment passed are dropped rather
// than all fired at once, and the daily one counts from now.
export function rebaseWakesAfterRestore(now: Date): Promise<{ dropped: number }> {
    return updateWakeState(state => {
        const before = state.planned.length
        state.planned = state.planned.filter(wake => Date.parse(wake.at) > now.getTime())
        state.last = now.toISOString()
        state.retryAt = null
        state.backoffMs = 0
        return { dropped: before - state.planned.length }
    })
}
