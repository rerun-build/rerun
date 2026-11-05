import { z } from 'zod'
import { connectorSkillReadOnlyError } from '@rerun/contracts'
import { modelFor } from '../agents/providers.js'
import { isUsable, resolveRunModel } from '../agents/availability.js'
import { ensureCliAuth } from '../connections/cli-auth.js'
import { syncCodexAuth } from '../connections/codex-auth.js'
import { generateStructured } from '../agents/structured.js'
import { connectorSkillOwners } from '../services/registry.js'
import { listSkillSummaries, readSkill, skillExists, writeSkillFolder, type SkillSummary } from './loader.js'
import { transitionSkillProposal } from '../db/repos/skill-proposals.js'
import { slugify } from '../lib/ids.js'
import { logger } from '../lib/logger.js'
import type { LoadedAgent } from '../agents/types.js'
import type { SkillProposalRow } from '../db/schema.js'

// A CLI provider that hangs would otherwise leave the row on `accepted` with nothing to settle it.
const APPLY_TIMEOUT_MS = 10 * 60 * 1000

const draftSchema = z.object({
    name: z.string().describe('The skill name, kept as it is when editing an existing skill'),
    description: z.string().describe('One line saying when this skill applies'),
    body: z.string().describe('The complete SKILL.md body in Markdown, the full revised procedure rather than a diff'),
})

export function applyProposalPrompt(input: {
    title: string
    instructions: string[]
    current: { name: string; description: string; body: string } | null
    others: SkillSummary[]
}): string {
    const rules = input.instructions.map(r => `- ${r}`).join('\n')

    if (input.current) {
        return `The user approved folding these rules into an existing skill.\n\nRules:\n${rules}\n\nCurrent skill "${input.current.name}" (${input.current.description}):\n\n${input.current.body}\n\nReturn the complete revised skill. Change only what the rules touch and keep every other line exactly as it is. Keep the name unchanged. Write it as instructions to the coworker's future self: the steps in order, the exact tool calls, the decisions and their criteria, and how to tell the work is done. No preamble, no mention of this conversation.`
    }

    const neighbours = input.others.length ? `\n\nSkills this coworker already has, so stay off their ground:\n${input.others.map(s => `- ${s.name}: ${s.description}`).join('\n')}` : ''
    return `The user approved capturing these rules as a new skill named "${input.title}".\n\nRules:\n${rules}${neighbours}\n\nWrite the skill. Keep it short and actionable, written as instructions to the coworker's future self: the steps in order, the exact tool calls, the decisions and their criteria, and how to tell the work is done. No preamble, no mention of this conversation.`
}

async function draft(agent: LoadedAgent, row: SkillProposalRow, abortSignal: AbortSignal): Promise<{ name: string; description: string; body: string; slug: string }> {
    const instructions = JSON.parse(row.instructionsJson) as string[]
    const editing = row.mode === 'edit' && row.slug ? await readSkill(agent.id, row.slug) : null
    const others = editing ? [] : await listSkillSummaries(agent.id).catch(() => [])

    const output = await generateStructured({
        model: modelFor(agent, undefined, undefined, undefined, { sessionId: `${agent.id}:skill-proposal` }),
        schema: draftSchema,
        prompt: applyProposalPrompt({ title: row.title, instructions, current: editing, others }),
        abortSignal,
    })

    // An edit keeps the folder it was read from: writeSkill would re-slugify from the name and
    // fork a second skill the moment the two ever drifted apart.
    const slug = editing ? editing.slug : slugify(output.name || row.title)
    return { ...output, name: editing ? editing.name : output.name, slug }
}

// The accept click comes with no model of its own, so the job writes on the pair the proposing
// conversation ran on: the agent's own pair may be one the user is not paying through, like a
// Rerun budget already spent while they chat on their Claude subscription. A connection removed or
// signed out since then falls back to the agent's pair rather than sending its model elsewhere.
async function agentForProposal(agent: LoadedAgent, row: SkillProposalRow): Promise<LoadedAgent> {
    if (!row.provider || !row.model) return agent
    const resolved = await resolveRunModel(agent, { connectionId: row.connectionId ?? undefined, provider: row.provider, model: row.model })
    if (resolved.provider !== row.provider || !isUsable(resolved.connection, resolved.model)) return agent
    return { ...agent, resolved }
}

export async function applySkillProposal(agent: LoadedAgent, row: SkillProposalRow): Promise<void> {
    const writer = await agentForProposal(agent, row).catch(() => agent)
    const { provider, connection } = writer.resolved
    let release = () => {}
    try {
        if (row.mode === 'edit' && (!row.slug || !skillExists(agent.id, row.slug))) throw new Error('That skill no longer exists.')

        release = await ensureCliAuth(provider, connection)
        const { name, description, body, slug } = await draft(writer, row, AbortSignal.timeout(APPLY_TIMEOUT_MS))
        const service = (await connectorSkillOwners(agent.id)).get(slug)
        if (service) throw new Error(connectorSkillReadOnlyError(slug, service))

        await writeSkillFolder(agent.id, { slug, name, description, body, files: [] })
        await transitionSkillProposal(agent.id, row.id, ['accepted'], 'applied', { appliedSlug: slug, error: null })
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        logger.warn({ err: error, agent: agent.id, proposal: row.id }, 'skill proposal apply failed')
        await transitionSkillProposal(agent.id, row.id, ['accepted'], 'failed', { error })
    } finally {
        release()
        if (provider === 'codex') await syncCodexAuth(connection).catch(() => {})
    }
}
