import { callHub } from '../runtime/hub.js'
import type { Trigger } from './loader.js'
import { productText } from '../brand/brand.js'

// The public URL is built from the agent's Rerun id, which only the hub knows: the engine
// addresses agents by its own local ids. A self-hosted engine with no hub simply has no URL to
// give, so callers fall back to telling the user to copy it from the Triggers tab.
export async function triggerPublicUrl(agentId: string, trigger: Trigger): Promise<string | null> {
    if (!trigger.token) return null
    try {
        const out = (await callHub({ id: agentId }, 'trigger_url', { slug: trigger.slug, token: trigger.token })) as { url?: string }
        return typeof out?.url === 'string' ? out.url : null
    } catch {
        return null
    }
}

export function urlLine(url: string | null): string {
    return url ? `Its public URL is ${url}` : productText("Its public URL is not available from here — open the coworker's Triggers tab in Rerun to copy it.")
}
