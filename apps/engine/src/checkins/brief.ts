import { foremanBriefSchema, type CheckinReason, type ForemanBrief } from '@rerun/contracts'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

const FETCH_TIMEOUT_MS = 10_000

// What a check-in runs on when the hub cannot hand its brief over: an older hub that has no such
// route, or a hub that is down. The same charter in short, and no tool of the hub.
export const CHECKIN_FALLBACK_INSTRUCTIONS = `You are the Chief of Staff of this Rerun workspace, and you just woke up on your own: nobody wrote to you. This is a check-in. You read and you suggest, you never act: nothing you can call here creates, changes, sends or deletes anything, and none of that is yours to try.

Look at how the workspace is doing through what you can read: your memory, your skills and routines, the company brain, the shared files and the shared database. Decide whether anything is worth a person's time today: a coworker that keeps failing, a question nobody answered, something the team has never tried that would help them. When something is, call report_to_member, then write the message they will read: short, what you saw, why it matters, the one next step you suggest, and up to three replies they send in one click to go ahead. When nothing is, say so in one line, which only goes to your own log. Never invent a problem to have something to say, and never raise again what the check-in message says you already told someone while nothing about it changed.`

// The instructions and the read-only hub tools of a check-in, with the token that opens those tools
// on the hub and nothing else. Never throws: the check-in goes on with the text above.
export async function fetchCheckinBrief(reason: CheckinReason): Promise<ForemanBrief> {
    const { RERUN_HUB_BASE_URL: hub, RERUN_API_KEY: token } = env()
    const fallback: ForemanBrief = { instructions: CHECKIN_FALLBACK_INSTRUCTIONS, tools: [] }
    if (!hub || !token) return fallback
    try {
        const res = await fetch(`${hub.replace(/\/$/, '')}/api/foreman/checkin-brief`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ reason }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`hub answered ${res.status}`)
        return foremanBriefSchema.parse(await res.json())
    } catch (err) {
        logger.warn({ err: String(err) }, 'check-in brief unavailable, running on the fallback')
        return fallback
    }
}
