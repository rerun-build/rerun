import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

const TIMEOUT_MS = 5000

export type EmbedOptions = { timeoutMs?: number }

export function embedBaseUrl(): string | null {
    const e = env()
    if (e.RERUN_HUB_BASE_URL) return e.RERUN_HUB_BASE_URL.replace(/\/$/, '')
    return null
}

function embedTarget(): { url: string; key: string } | null {
    const base = embedBaseUrl()
    const key = env().RERUN_API_KEY
    if (!base || !key) return null
    return { url: `${base}/api/embed`, key }
}

export async function embedText(text: string, { timeoutMs = TIMEOUT_MS }: EmbedOptions = {}): Promise<number[] | null> {
    const target = embedTarget()
    if (!target) {
        logger.warn({ hubBaseUrl: embedBaseUrl(), hasKey: Boolean(env().RERUN_API_KEY) }, 'embedding skipped: hub base url or api key missing')
        return null
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const res = await fetch(target.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.key}` },
            body: JSON.stringify({ text }),
            signal: controller.signal,
        })
        if (!res.ok) {
            logger.warn({ status: res.status }, 'embed request failed')
            return null
        }
        const data = (await res.json()) as { embedding?: number[] | null }
        return Array.isArray(data.embedding) ? data.embedding : null
    } catch (err) {
        logger.debug({ err: String(err) }, 'embed request error')
        return null
    } finally {
        clearTimeout(timer)
    }
}
