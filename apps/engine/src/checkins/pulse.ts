import { createHash } from 'node:crypto'
import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { getAgent } from '../agents/registry.js'
import { checkinsEnabled, env } from '../config/env.js'
import { listMembers } from '../db/repos/members.js'
import { getSystemDb } from '../db/systemDb.js'
import { logger } from '../lib/logger.js'
import { agentHasLiveRun } from '../runtime/run-control.js'
import { buildDigest } from './digest.js'
import { decide } from './rules.js'
import { checkinInFlight, startCheckin } from './run.js'
import { askTriage } from './triage.js'

// The pulse is taken once a day, in the owner's daytime: from 9:00 plus a few minutes of its own to
// each box, so a fleet in one time zone does not ask the hub at the same second, and never after 18:00.
const DAY_START_MINUTES = 9 * 60
const SPREAD_MINUTES = 120
const DAY_END_MINUTES = 18 * 60
const DAY_KEY = 'checkin.pulse.day'

function spreadMinutes(): number {
    const seed = env().RERUN_API_KEY ?? env().RERUN_DATA_DIR
    return createHash('sha256').update(seed).digest().readUInt16BE(0) % SPREAD_MINUTES
}

function localClock(now: Date, timezone: string): { day: string; minutes: number } {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]))
    return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}

async function readMeta(key: string): Promise<string | null> {
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    const rs = await client.execute({ sql: 'SELECT value FROM system_meta WHERE key = ?', args: [key] })
    return (rs.rows[0]?.value as string | undefined) ?? null
}

async function writeMeta(key: string, value: string): Promise<void> {
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    await client.execute({ sql: 'INSERT INTO system_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: [key, value] })
}

async function lastCheckinAt(): Promise<number | null> {
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    const at = (await client.execute("SELECT max(started_at) AS at FROM runs WHERE trigger_source = 'checkin'")).rows[0]?.at as string | null
    return at ? Date.parse(at) : null
}

let taking = false

// Called on every tick of the scheduler; does something once a day at most. The owner is the first
// person who ever wrote on the box, and without a time zone for them there is no daytime to wait for.
export async function runPulseIfDue(now = new Date()): Promise<void> {
    if (taking || !checkinsEnabled()) return
    taking = true
    try {
        const foreman = await getAgent(FOREMAN_AGENT_ID)
        if (!foreman.config.enabled || !foreman.config.proactive.enabled) return
        const [owner] = (await listMembers()).sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt))
        if (!owner?.timezone) return
        const clock = localClock(now, owner.timezone)
        if (clock.minutes < DAY_START_MINUTES + spreadMinutes() || clock.minutes >= DAY_END_MINUTES) return
        if ((await readMeta(DAY_KEY)) === clock.day) return
        // Busy now is not a no for today: the next tick tries again.
        if (agentHasLiveRun(FOREMAN_AGENT_ID) || checkinInFlight()) return
        await writeMeta(DAY_KEY, clock.day)

        const digest = await buildDigest(now.getTime())
        const decision = decide({ digest, lastCheckinAt: await lastCheckinAt(), now: now.getTime() })
        const go = decision === 'checkin' || (decision === 'ask' && (await askTriage(digest)))
        logger.info({ decision, go, day: clock.day }, 'pulse taken')
        if (go) await startCheckin('pulse')
    } catch (err) {
        logger.warn({ err: String(err) }, 'pulse failed')
    } finally {
        taking = false
    }
}

const DAY_MS = 24 * 60 * 60_000

// When the pulse next looks, in the owner's day: today's window when it has not looked yet and the
// window is not over, tomorrow's otherwise. Null without a time zone to wait for. Read for the
// card, an hour of daylight saving off at most.
export async function nextPulseAt(now = new Date()): Promise<Date | null> {
    const [owner] = (await listMembers()).sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt))
    if (!owner?.timezone) return null
    const clock = localClock(now, owner.timezone)
    const start = DAY_START_MINUTES + spreadMinutes()
    const lookedToday = (await readMeta(DAY_KEY)) === clock.day
    const today = !lookedToday && clock.minutes < DAY_END_MINUTES
    const minutesAhead = today ? Math.max(0, start - clock.minutes) : DAY_MS / 60_000 - clock.minutes + start
    return new Date(now.getTime() + minutesAhead * 60_000)
}

