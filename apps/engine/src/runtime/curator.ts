import { z } from 'zod'
import { modelFor, type ModelOverride } from '../agents/providers.js'
import { ensureCliAuth } from '../connections/cli-auth.js'
import { generateStructured } from '../agents/structured.js'
import { writeMemory, updateMemory, deleteMemory, recallMemory, type RecalledMemory } from '../memory/store.js'
import { listSkillSummaries, type SkillSummary } from '../skills/loader.js'
import { logger } from '../lib/logger.js'
import type { LoadedAgent } from '../agents/types.js'

const CURATOR_TIMEOUT_MS = 10 * 60 * 1000

export const curationSchema = z.object({
    memory: z
        .object({
            content: z.string().describe('The durable, self-contained fact to remember'),
            updateId: z
                .string()
                .nullable()
                .describe('If this fact updates or supersedes one of the existing related memories shown to you, set it to that memory id. Otherwise null to store a new memory.'),
        })
        .nullable()
        .describe('A durable, standalone fact or standing preference worth remembering across conversations, never a rule about how the work is done even when phrased as a preference, or null if nothing is worth keeping'),
    obsoleteIds: z.array(z.string()).describe('Ids of existing related memories now wrong or fully contradicted by this exchange, which should be deleted; return an empty array when none are obsolete'),
})

export function curatorPrompt({ userText, assistantText, existing, skills }: { userText: string; assistantText: string; existing: RecalledMemory[]; skills: SkillSummary[] }): string {
    const skillsBlock = skills.length
        ? `\n\nThese skills already govern how this coworker works, so anything belonging to one of them is not a memory:\n${skills.map(s => `- ${s.name} (slug: ${s.slug}): ${s.description}`).join('\n')}`
        : ''
    const existingBlock = existing.length
        ? `\n\nExisting related memories you already hold. You may UPDATE one in place by returning its id, or mark some obsolete to delete:\n${existing.map(m => `- [${m.id}] (${m.kind}) ${m.content}`).join('\n')}`
        : ''

    return `Review this exchange and decide what is worth remembering for the future.\n\nUser: ${userText}\n\nAssistant: ${assistantText}\n\nReturn a durable memory if a lasting fact emerged, otherwise null. Anything that says how the work is done belongs in a skill, not in memory: a procedure, a checklist, a workflow, an output format, a calibre or length target, a naming or style convention, a rule for a recurring task, or a correction of what the assistant just produced. Return null for all of it, even when it is phrased as a preference, and never fold it into an existing memory through updateId. Memory is the fallback for what no skill governs: standalone facts and standing preferences. If the exchange corrects or refines one of the existing related memories shown to you, update it in place by returning its id rather than storing a duplicate.${skillsBlock}${existingBlock}`
}

export async function runCurator(agent: LoadedAgent, sessionId: string, userText: string, assistantText: string, override?: ModelOverride): Promise<void> {
    const cfg = agent.config.selfImprovement
    if (!cfg.autoMemory) return

    const [existing, skills] = await Promise.all([
        recallMemory(agent, `${userText}\n\n${assistantText}`, 5, { reinforce: 'none', includeDormant: true }).catch(() => []),
        agent.config.tools.skills ? listSkillSummaries(agent.id).catch(() => []) : Promise.resolve([]),
    ])
    const knownIds = new Set(existing.map(m => m.id))

    const release = await ensureCliAuth(agent.resolved.provider, agent.resolved.connection)
    const output = await generateStructured({
        model: modelFor(agent, override, undefined, undefined, { sessionId: `${agent.id}:curator` }),
        schema: curationSchema,
        prompt: curatorPrompt({ userText, assistantText, existing, skills }),
        abortSignal: AbortSignal.timeout(CURATOR_TIMEOUT_MS),
    }).finally(release)

    const updateId = output.memory?.updateId && knownIds.has(output.memory.updateId) ? output.memory.updateId : null
    for (const id of output.obsoleteIds) {
        if (knownIds.has(id) && id !== updateId) await deleteMemory(agent, id).catch(e => logger.warn({ err: String(e) }, 'auto memory delete failed'))
    }
    if (output.memory) {
        if (updateId) await updateMemory(agent, updateId, output.memory.content).catch(e => logger.warn({ err: String(e) }, 'auto memory update failed'))
        else await writeMemory(agent, output.memory.content, 'learned').catch(e => logger.warn({ err: String(e) }, 'auto memory failed'))
    }
}
