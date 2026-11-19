import { moldwrightUpstreamModelsSchema, type Provider } from '@moldwright/contracts'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

const FRESH_MS = 5 * 60_000
const FIRST_WAIT_MS = 2_000
const FETCH_TIMEOUT_MS = 10_000

let known: Record<string, string> | undefined
let askedAt = -Infinity

async function askHub(): Promise<void> {
    const { RERUN_HUB_BASE_URL: hub, RERUN_API_KEY: token } = env()
    if (!hub || !token) return
    const res = await fetch(`${hub.replace(/\/$/, '')}/api/llm/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`hub answered ${res.status}`)
    known = moldwrightUpstreamModelsSchema.parse(await res.json()).models
}

async function upstreamModels(): Promise<Record<string, string>> {
    if (Date.now() - askedAt >= FRESH_MS) {
        askedAt = Date.now()
        const asking = askHub().catch(err => logger.warn({ err: String(err) }, 'rerun upstream models unavailable'))
        if (!known) await Promise.race([asking, new Promise(resolve => setTimeout(resolve, FIRST_WAIT_MS).unref())])
    }
    return known ?? {}
}

export async function answeringModel(provider: Provider, model: string): Promise<string> {
    if (provider !== 'rerun') return model
    return (await upstreamModels())[model] ?? model
}
