import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { env, setEnv } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { buildCommit } from '../runtime/build-info.js'

const KEY_FILE = 'engine.key'
const HUB_FILE = 'hub.json'
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000]

type PairedHub = { hubUrl: string; workspaceId: number }

const pathOf = (file: string) => join(env().RERUN_DATA_DIR, file)

function readPairedHub(): PairedHub | null {
    try {
        return JSON.parse(readFileSync(pathOf(HUB_FILE), 'utf8')) as PairedHub
    } catch {
        return null
    }
}

export function loadPairingIdentity(): void {
    const { RERUN_API_KEY, RERUN_HUB_BASE_URL, RERUN_DATA_DIR } = env()
    const pairing = Boolean(process.env.RERUN_PAIR_TOKEN)
    if (!RERUN_API_KEY && (pairing || existsSync(pathOf(KEY_FILE)))) {
        mkdirSync(RERUN_DATA_DIR, { recursive: true })
        if (!existsSync(pathOf(KEY_FILE))) writeFileSync(pathOf(KEY_FILE), randomBytes(32).toString('hex'), { mode: 0o600 })
        setEnv({ RERUN_API_KEY: readFileSync(pathOf(KEY_FILE), 'utf8').trim() })
    }
    const paired = readPairedHub()
    if (!RERUN_HUB_BASE_URL && paired) setEnv({ RERUN_HUB_BASE_URL: paired.hubUrl })
}

class PairingRefused extends Error {}

async function postPairing(hubUrl: string, token: string): Promise<PairedHub> {
    const response = await fetch(`${hubUrl.replace(/\/$/, '')}/api/engines/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, apiKey: env().RERUN_API_KEY, url: process.env.RERUN_PUBLIC_URL || null, version: buildCommit() }),
        signal: AbortSignal.timeout(30_000),
    })
    const body = (await response.json().catch(() => ({}))) as { error?: string; workspaceId?: number }
    if (response.status >= 400 && response.status < 500) throw new PairingRefused(body.error ?? `the app refused the pairing (${response.status})`)
    if (!response.ok || typeof body.workspaceId !== 'number') throw new Error(body.error ?? `the app answered ${response.status}`)
    return { hubUrl: hubUrl.replace(/\/$/, ''), workspaceId: body.workspaceId }
}

export async function pairWithHub(): Promise<void> {
    const token = process.env.RERUN_PAIR_TOKEN
    const hubUrl = process.env.RERUN_HUB_URL
    if (!token || !hubUrl) return
    if (readPairedHub()) return

    for (let attempt = 0; ; attempt++) {
        try {
            const paired = await postPairing(hubUrl, token)
            writeFileSync(pathOf(HUB_FILE), JSON.stringify(paired))
            setEnv({ RERUN_HUB_BASE_URL: paired.hubUrl })
            logger.info({ hub: paired.hubUrl, workspaceId: paired.workspaceId }, 'paired with the app: this server now runs the coworkers of its workspace')
            return
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            const delay = RETRY_DELAYS_MS[attempt]
            if (err instanceof PairingRefused || delay === undefined) {
                logger.error({ hub: hubUrl }, `pairing failed: ${message}`)
                return
            }
            logger.warn({ hub: hubUrl, retryInMs: delay }, `pairing not done yet: ${message}`)
            await new Promise(resolve => setTimeout(resolve, delay))
        }
    }
}
