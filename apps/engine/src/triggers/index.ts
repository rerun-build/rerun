import { listTriggers } from './loader.js'

export async function buildTriggerIndex(agentId: string): Promise<string> {
    const triggers = (await listTriggers(agentId)).filter(t => t.enabled).sort((a, b) => a.slug.localeCompare(b.slug))
    if (triggers.length === 0) return ''
    const lines = triggers.map(t => `- ${t.name} (slug: ${t.slug}): ${t.methods.join('/')}`)
    return `These webhook triggers start a run when their public URL is called by an external service. Manage them with the trigger_* tools, and use trigger_get to read a trigger's URL, its call count and its last call.\n\n${lines.join('\n')}`
}
