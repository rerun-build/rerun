import { z } from 'zod'
import { modelFor, type ModelOverride } from '../agents/providers.js'
import { ensureCliAuth } from '../connections/cli-auth.js'
import { generateStructured } from '../agents/structured.js'
import { recallMemory, writeMemory, updateMemory } from './store.js'
import { logger } from '../lib/logger.js'
import type { LoadedAgent } from '../agents/types.js'

// Past this the memory is written as a new one, which is what a failed reconcile already does.
const RECONCILE_TIMEOUT_MS = 10 * 60 * 1000

const decisionSchema = z.object({
    updateId: z
        .string()
        .nullable()
        .describe('Id of the existing memory that this new fact updates, replaces, or restates (the same underlying fact, e.g. a changed or corrected value). Null if the new fact is genuinely distinct and must be stored separately.'),
})

export async function reconcileWrite(agent: LoadedAgent, content: string, kind: string, tags: string[], override?: ModelOverride): Promise<{ id: string; updated: boolean }> {
    const candidates = await recallMemory(agent, content, 5, { reinforce: 'none', includeDormant: true }).catch(() => [])
    const exact = candidates.find(c => c.content.trim() === content.trim())
    if (exact) return { id: exact.id, updated: false }
    if (candidates.length === 0) return { id: await writeMemory(agent, content, kind, tags), updated: false }

    let updateId: string | null = null
    let release = () => {}
    try {
        release = await ensureCliAuth(agent.resolved.provider, agent.resolved.connection)
        const output = await generateStructured({
            model: modelFor(agent, override, undefined, undefined, { sessionId: `${agent.id}:memory-reconcile` }),
            schema: decisionSchema,
            prompt: `A memory is about to be saved:\n"${content}"\n\nExisting similar memories you already hold:\n${candidates.map(c => `- [${c.id}] (${c.kind}) ${c.content}`).join('\n')}\n\nDoes the new memory update, replace, or restate one of the existing ones (the same underlying fact, e.g. a changed or corrected value)? If so return its id. If the new memory is a genuinely distinct fact, return null. Be conservative: only return an id when it clearly supersedes an existing memory.`,
            abortSignal: AbortSignal.timeout(RECONCILE_TIMEOUT_MS),
        })
        const known = new Set(candidates.map(c => c.id))
        if (output.updateId && known.has(output.updateId)) updateId = output.updateId
    } catch (e) {
        logger.warn({ err: String(e) }, 'memory reconcile failed')
    } finally {
        release()
    }

    if (updateId) {
        await updateMemory(agent, updateId, content)
        return { id: updateId, updated: true }
    }
    return { id: await writeMemory(agent, content, kind, tags), updated: false }
}
