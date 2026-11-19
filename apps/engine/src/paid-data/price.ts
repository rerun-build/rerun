import type { PaidDataPriceMultiplier } from '@moldwright/contracts'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

const TIMEOUT_MS = 10_000
const CACHE_MS = 5 * 60_000

type HubPaidData = { enabled: boolean; multiplier: PaidDataPriceMultiplier }

let cached: { answer: HubPaidData; at: number } | null = null
let inFlight: Promise<HubPaidData> | null = null

const linkedToHub = (): boolean => Boolean(env().RERUN_HUB_BASE_URL && env().RERUN_API_KEY)

async function askHub(): Promise<HubPaidData> {
    const { RERUN_HUB_BASE_URL: hub, RERUN_API_KEY: token } = env()
    if (!hub || !token) return { enabled: false, multiplier: null }
    try {
        const res = await fetch(`${hub.replace(/\/$/, '')}/api/paid-data`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
        const body = (await res.json().catch(() => null)) as { priceMultiplier?: unknown; enabled?: unknown } | null
        const multiplier = body?.priceMultiplier
        if (!res.ok || typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0) {
            logger.warn({ status: res.status }, 'the hub gave no paid data price multiplier')
            return cached?.answer ?? { enabled: true, multiplier: null }
        }
        const answer = { enabled: body?.enabled !== false, multiplier }
        cached = { answer, at: Date.now() }
        return answer
    } catch (err) {
        logger.warn({ err: String(err) }, 'could not read the paid data terms from the hub')
        return cached?.answer ?? { enabled: true, multiplier: null }
    }
}

async function hubPaidData(): Promise<HubPaidData> {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.answer
    inFlight ??= askHub().finally(() => {
        inFlight = null
    })
    return inFlight
}

export async function hubPriceMultiplier(): Promise<PaidDataPriceMultiplier> {
    return (await hubPaidData()).multiplier
}

export async function paidDataOffered(): Promise<boolean> {
    return linkedToHub() && (await hubPaidData()).enabled
}

export function paidDataOfferedSoFar(): boolean {
    return linkedToHub() && (cached?.answer.enabled ?? true)
}

export function forgetPriceMultiplier(): void {
    cached = null
    inFlight = null
}
