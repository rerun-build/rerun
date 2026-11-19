import { createHash } from 'node:crypto'
import { tool, type ToolSet } from 'ai'
import { connectorSkillReadOnlyError, skillProposalInputSchema, type SkillProposalInput } from '@moldwright/contracts'
import { skillExists } from '../../skills/loader.js'
import { disabledSkillSet } from '../../skills/switch.js'
import { connectorSkillOwners } from '../../services/registry.js'
import {
    appendSkillProposalInstruction,
    findSkillProposalByFingerprint,
    insertSkillProposal,
    openSkillProposalForSession,
} from '../../db/repos/skill-proposals.js'
import { newId, slugify } from '../../lib/ids.js'
import { logger } from '../../lib/logger.js'
import type { RunContext } from '../../runtime/context.js'

const SHOWN =
    'Proposal shown to the user as a row in the chat. In your message, tell them in one short sentence that you suggest keeping this as a skill and that they decide from that row. Do not write the skill yourself and do not raise it again after that.'
const MERGED = 'Added to the proposal already waiting in this conversation. Say nothing about it.'
const ALREADY = 'Already proposed once. Nothing shown, and do not raise it again.'
const NOT_SAVED = 'Could not save the proposal. Nothing shown. Do not retry.'

function proposalResult(status: 'shown' | 'merged', proposalId: string, message: string): string {
    return JSON.stringify({ status, proposalId, message })
}

export function proposalFingerprint(input: { mode: string; slug: string | null; title: string; instruction: string }): string {
    const target = input.slug ?? slugify(input.title)
    const rule = input.instruction
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    return createHash('sha256').update(`${input.mode}|${target}|${rule}`).digest('hex').slice(0, 32)
}

export async function proposalGuard(agentId: string, input: SkillProposalInput, off: ReadonlySet<string> = new Set()): Promise<string | null> {
    if (input.mode === 'edit') {
        if (!input.slug) return 'An edit proposal needs the slug of the skill to change. Nothing shown.'
        if (off.has(input.slug) || !skillExists(agentId, input.slug)) return `No skill with slug "${input.slug}". Nothing shown.`
        const service = (await connectorSkillOwners(agentId)).get(input.slug)
        if (service) return connectorSkillReadOnlyError(input.slug, service)
    }
    return null
}

export function skillProposeTool(ctx: RunContext): ToolSet {
    const agentId = ctx.agent.id
    const off = disabledSkillSet({ disabledSkills: ctx.agent.config?.disabledSkills })

    return {
        skill_propose: tool({
            description:
                'Propose keeping a settled way of working as a skill: a standing rule the user just gave, or a whole flow you built together once they validated it, never a step of a flow still being shaped. It shows a small row the user accepts or dismisses, does NOT pause you and writes nothing: finish your turn and mention it in one short sentence. Do not draft the skill body, it is written on accept. Use mode "edit" with the slug of the skill that already covers that ground, "create" only when none does.',
            inputSchema: skillProposalInputSchema,
            execute: async input => {
                const refusal = await proposalGuard(agentId, input, off)
                if (refusal) return refusal

                try {
                    const fingerprint = proposalFingerprint(input)
                    const billedBy = { connectionId: ctx.agent.resolved.connection?.id ?? null, provider: ctx.provider, model: ctx.model }
                    const seen = await findSkillProposalByFingerprint(agentId, fingerprint)
                    if (seen) return ALREADY

                    const open = await openSkillProposalForSession(agentId, ctx.sessionId)
                    if (open) {
                        await appendSkillProposalInstruction(agentId, open.id, { ...billedBy, instruction: input.instruction, title: input.title, summary: input.summary, fingerprint })
                        ctx.skillProposals?.push({ proposalId: open.id, mode: open.mode, title: input.title })
                        return proposalResult('merged', open.id, MERGED)
                    }

                    const row = await insertSkillProposal(agentId, {
                        ...billedBy,
                        sessionId: ctx.sessionId,
                        runId: ctx.runId ?? null,
                        toolCallId: newId(),
                        mode: input.mode,
                        slug: input.slug,
                        title: input.title,
                        summary: input.summary,
                        instruction: input.instruction,
                        fingerprint,
                    })
                    ctx.skillProposals?.push({ proposalId: row.id, mode: row.mode, title: row.title })
                    return proposalResult('shown', row.id, SHOWN)
                } catch (err) {
                    logger.warn({ err: String(err), agent: agentId }, 'skill proposal not saved')
                    return NOT_SAVED
                }
            },
        }),
    }
}
