import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { brandedText, brandDiscretionNote, engineBrandSchema, RERUN_ENGINE_BRAND, type EngineBrand } from '@rerun/contracts'
import { boxBrandPath, dataDir } from '../config/paths.js'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

// One machine is one workspace, so its brand is one value for the whole process. It is asked of the
// hub rather than pushed by it: a run the hub never starts (a routine, a webhook, a check-in) knows it
// as a chat does, and a rename reaches every run within this long.
const FRESH_MS = 60_000
// A run waits this long at most, then goes on with what was last known.
const WAIT_MS = 2_000
const FETCH_TIMEOUT_MS = 10_000

let held: EngineBrand | undefined
let askedAt = -Infinity
let asking: Promise<void> | null = null

function readStored(): EngineBrand {
    try {
        return engineBrandSchema.parse(JSON.parse(readFileSync(boxBrandPath(), 'utf8')))
    } catch {
        return RERUN_ENGINE_BRAND
    }
}

export function boxBrand(): EngineBrand {
    return (held ??= readStored())
}

export const productName = (): string => boxBrand().name

// The product, in a text of the engine, under the name of the brand.
export const productText = (text: string): string => brandedText(text, boxBrand())

export const brandNote = (): string => brandDiscretionNote(boxBrand())

const sameBrand = (a: EngineBrand, b: EngineBrand): boolean => a.name === b.name && a.whiteLabel === b.whiteLabel && a.supportEmail === b.supportEmail

async function keep(next: EngineBrand): Promise<void> {
    if (sameBrand(boxBrand(), next)) return
    held = next
    await mkdir(dataDir(), { recursive: true })
    const tmp = `${boxBrandPath()}.tmp`
    await writeFile(tmp, `${JSON.stringify(next, null, 4)}\n`, 'utf8')
    await rename(tmp, boxBrandPath())
    logger.info({ brand: next.name }, 'the machine runs under another brand')
}

async function askHub(): Promise<void> {
    const { RERUN_HUB_BASE_URL: hub, RERUN_API_KEY: token } = env()
    if (!hub || !token) return
    const res = await fetch(`${hub.replace(/\/$/, '')}/api/engines/brand`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`hub answered ${res.status}`)
    await keep(engineBrandSchema.parse(await res.json()))
}

// Called as a run starts, before anything is written for its model. A hub that fails, or predates the
// route, is asked again once FRESH_MS has passed, and what was last known stands meanwhile.
export async function refreshBrand(): Promise<void> {
    if (Date.now() - askedAt >= FRESH_MS) {
        askedAt = Date.now()
        asking = askHub()
            .catch(err => logger.warn({ err: String(err) }, 'brand unavailable'))
            .finally(() => {
                asking = null
            })
    }
    if (asking) await Promise.race([asking, new Promise(resolve => setTimeout(resolve, WAIT_MS).unref())])
}
