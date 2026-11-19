import { checkinTriageResponseSchema, type CheckinDigest } from '@rerun/contracts'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

const FETCH_TIMEOUT_MS = 10_000

// The hub weighs a digest the rules could not settle. Any failure (an older hub with no such route,
// no model key, a timeout) reads as no: the rules alone decide, and in the grey zone they wait.
export async function askTriage(digest: CheckinDigest): Promise<boolean> {
    const { RERUN_HUB_BASE_URL: hub, RERUN_API_KEY: token } = env()
    if (!hub || !token) return false
    try {
        const res = await fetch(`${hub.replace(/\/$/, '')}/api/foreman/triage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ digest }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`hub answered ${res.status}`)
        return checkinTriageResponseSchema.parse(await res.json()).checkin
    } catch (err) {
        logger.warn({ err: String(err) }, 'check-in triage unavailable, the rules decide alone')
        return false
    }
}
