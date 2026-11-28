import { z } from 'zod'
import { connectorSkillReadOnlyError, RERUN_CONNECTION_ID } from '@rerun/contracts'
import { modelFor, type ModelOverride } from '../agents/providers.js'
import { isUsable, resolveRunModel, type RunModel } from '../agents/availability.js'
import { pickBackup } from '../agents/backups.js'
import { armPlanLimitLatch, isPlanLimitLatched } from '../connections/plan-limits.js'
import { isBudgetLatched } from '../runtime/budget-latch.js'
import { classifyProviderError, RUN_ERROR_CODES } from '../runtime/provider-errors.js'
import { ensureCliAuth } from '../connections/cli-auth.js'
import { syncCodexAuth } from '../connections/codex-auth.js'
import { generateStructured } from '../agents/structured.js'
import { connectorSkillOwners } from '../services/registry.js'
import { readSkill, skillExists, writeSkillFolder, type SkillSummary } from './loader.js'
import { listUsableSkillSummaries } from './brain.js'
import { transitionSkillProposal } from '../db/repos/skill-proposals.js'
import { slugify } from '../lib/ids.js'
import { SKILL_BODY_MAX_WORDS, SKILL_DESCRIPTION_MAX_CHARS, SKILL_STYLE } from './style.js'
import { logger } from '../lib/logger.js'
import type { LoadedAgent } from '../agents/types.js'
import type { SkillProposalRow } from '../db/schema.js'

// A CLI provider that hangs would otherwise leave the row on `accepted` with nothing to settle it.
const APPLY_TIMEOUT_MS = 10 * 60 * 1000

const draftSchema = z.object({
    name: z.string().describe('The skill name, kept as it is when editing an existing skill'),
    description: z.string().describe(`One line under ${SKILL_DESCRIPTION_MAX_CHARS} characters saying when this skill applies`),
    body: z.string().describe(`The complete SKILL.md body in Markdown, the full revised procedure rather than a diff, under ${SKILL_BODY_MAX_WORDS} words for a new skill`),
})

export function applyProposalPrompt(input: {
    title: string
    instructions: string[]
    current: { name: string; description: string; body: string } | null
    others: SkillSummary[]
}): string {
    const rules = input.instructions.map(r => `- ${r}`).join('\n')

    if (input.current) {
        return `The user approved folding these rules into an existing skill.\n\nRules:\n${rules}\n\nCurrent skill "${input.current.name}" (${input.current.description}):\n\n${input.current.body}\n\nReturn the complete revised skill. Change only what the rules touch and keep every other line exactly as it is. Keep the name unchanged. Write what you add or change as instructions to the coworker's future self, with no mention of this conversation. ${SKILL_STYLE}`
    }

    const neighbours = input.others.length ? `\n\nSkills this coworker already has, so stay off their ground:\n${input.others.map(s => `- ${s.name}: ${s.description}`).join('\n')}` : ''
    return `The user approved capturing these rules as a new skill named "${input.title}".\n\nRules:\n${rules}${neighbours}\n\nWrite the skill as instructions to the coworker's future self, with no mention of this conversation. ${SKILL_STYLE}`
}

async function draft(agent: LoadedAgent, row: SkillProposalRow, abortSignal: AbortSignal): Promise<{ name: string; description: string; body: string; slug: string }> {
    const instructions = JSON.parse(row.instructionsJson) as string[]
    const editing = row.mode === 'edit' && row.slug ? await readSkill(agent.id, row.slug) : null
    const others = editing ? [] : await listUsableSkillSummaries(agent.id).catch(() => [])

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

const isOut = (run: RunModel): boolean => Boolean(run.connection && run.connection.id !== RERUN_CONNECTION_ID && isPlanLimitLatched(run.connection.id))

// The Rerun credit is spent only when someone asked for it: by picking it in the conversation, or as
// the last resort of the backups. A coworker merely following a Rerun workspace default did not.
function takesOver(run: RunModel, spentId: string, rerunAsked: boolean): boolean {
    const id = run.connection?.id
    if (!id || id === spentId || !isUsable(run.connection, run.model)) return false
    return id === RERUN_CONNECTION_ID ? rerunAsked && !isBudgetLatched() : !isPlanLimitLatched(id)
}

// A subscription out of its window fails the job within seconds, the same way it fails a chat run:
// the model picked in the conversation since, then the coworker's own pair, then the backups a run
// moves to.
async function freeWriter(agent: LoadedAgent, writer: LoadedAgent, picked: LoadedAgent | null): Promise<LoadedAgent> {
    if (!isOut(writer.resolved)) return writer
    const spentId = writer.resolved.connection!.id
    if (picked && takesOver(picked.resolved, spentId, true)) return picked
    if (takesOver(agent.resolved, spentId, false)) return agent
    const backup = await pickBackup(new Set([spentId]))
    return backup ? { ...agent, resolved: backup } : writer
}

async function pickedWriter(agent: LoadedAgent, picked: ModelOverride | undefined): Promise<LoadedAgent | null> {
    if (!picked?.model) return null
    const resolved = await resolveRunModel(agent, { connectionId: picked.connectionId, model: picked.model }).catch(() => null)
    return resolved ? { ...agent, resolved } : null
}

async function draftOn(writer: LoadedAgent, row: SkillProposalRow, abortSignal: AbortSignal): Promise<Awaited<ReturnType<typeof draft>>> {
    const { provider, connection } = writer.resolved
    let release = () => {}
    try {
        release = await ensureCliAuth(provider, connection)
        return await draft(writer, row, abortSignal)
    } finally {
        release()
        if (provider === 'codex') await syncCodexAuth(connection).catch(() => {})
    }
}

// The job may be the first call to meet the limit: it latches the subscription as a run would and
// carries on once on the next free model, so the next proposal does not knock on the same door.
async function draftOrMoveOn(agent: LoadedAgent, writer: LoadedAgent, picked: LoadedAgent | null, row: SkillProposalRow, abortSignal: AbortSignal): Promise<Awaited<ReturnType<typeof draft>>> {
    try {
        return await draftOn(writer, row, abortSignal)
    } catch (err) {
        const { provider, connection } = writer.resolved
        if (!connection || connection.id === RERUN_CONNECTION_ID || abortSignal.aborted || classifyProviderError(provider, err) !== RUN_ERROR_CODES.usageLimit) throw err
        armPlanLimitLatch(connection.id)
        const next = await freeWriter(agent, writer, picked)
        if (next === writer) throw err
        logger.warn({ agent: agent.id, proposal: row.id, from: `${connection.id}:${writer.resolved.model}`, to: `${next.resolved.connection?.id}:${next.resolved.model}` }, 'subscription limit reached, writing the skill on another model')
        return draftOn(next, row, abortSignal)
    }
}

// `picked` is the model the conversation is set to now, which the accept click carries: it may have
// moved off the subscription the proposal was made on.
export async function applySkillProposal(agent: LoadedAgent, row: SkillProposalRow, picked?: ModelOverride): Promise<void> {
    try {
        if (row.mode === 'edit' && (!row.slug || !skillExists(agent.id, row.slug))) throw new Error('That skill no longer exists.')

        const pickedAgent = await pickedWriter(agent, picked)
        const writer = await freeWriter(agent, await agentForProposal(agent, row).catch(() => agent), pickedAgent)
        const { name, description, body, slug } = await draftOrMoveOn(agent, writer, pickedAgent, row, AbortSignal.timeout(APPLY_TIMEOUT_MS))
        const service = (await connectorSkillOwners(agent.id)).get(slug)
        if (service) throw new Error(connectorSkillReadOnlyError(slug, service))

        await writeSkillFolder(agent.id, { slug, name, description, body, files: [] })
        await transitionSkillProposal(agent.id, row.id, ['accepted'], 'applied', { appliedSlug: slug, error: null })
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        logger.warn({ err: error, agent: agent.id, proposal: row.id }, 'skill proposal apply failed')
        await transitionSkillProposal(agent.id, row.id, ['accepted'], 'failed', { error })
    }
}
