import { and, desc, eq, inArray, like } from 'drizzle-orm'
import type { Provider, SkillProposal, SkillProposalMode, SkillProposalStatus } from '@moldwright/contracts'
import { getSystemDb } from '../systemDb.js'
import { skillProposals, type SkillProposalRow } from '../schema.js'
import { newId, nowIso } from '../../lib/ids.js'

export type SkillProposalModel = { connectionId: string | null; provider: Provider; model: string }

export type InsertSkillProposal = SkillProposalModel & {
    sessionId: string
    runId: string | null
    toolCallId: string
    mode: SkillProposalMode
    slug: string | null
    title: string
    summary: string
    instruction: string
    fingerprint: string
}

export function toSkillProposal(row: SkillProposalRow): SkillProposal {
    return {
        id: row.id,
        sessionId: row.sessionId,
        toolCallId: row.toolCallId,
        mode: row.mode as SkillProposalMode,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        instructions: JSON.parse(row.instructionsJson) as string[],
        status: row.status as SkillProposalStatus,
        appliedSlug: row.appliedSlug,
        error: row.error,
        createdAt: row.createdAt,
    }
}

export async function insertSkillProposal(agentId: string, input: InsertSkillProposal): Promise<SkillProposalRow> {
    const row: SkillProposalRow = {
        id: newId(),
        agentId,
        sessionId: input.sessionId,
        runId: input.runId,
        toolCallId: input.toolCallId,
        mode: input.mode,
        slug: input.slug,
        title: input.title,
        summary: input.summary,
        instructionsJson: JSON.stringify([input.instruction]),
        fingerprintsJson: JSON.stringify([input.fingerprint]),
        status: 'proposed',
        appliedSlug: null,
        error: null,
        createdAt: nowIso(),
        decidedAt: null,
        connectionId: input.connectionId,
        provider: input.provider,
        model: input.model,
    }
    const { db } = await getSystemDb(agentId)
    await db.insert(skillProposals).values(row)
    return row
}

export async function getSkillProposal(agentId: string, id: string): Promise<SkillProposalRow | undefined> {
    const { db } = await getSystemDb(agentId)
    const rows = await db.select().from(skillProposals).where(eq(skillProposals.id, id)).limit(1)
    return rows[0]
}

export async function listSessionSkillProposals(agentId: string, sessionId: string): Promise<SkillProposalRow[]> {
    const { db } = await getSystemDb(agentId)
    return db.select().from(skillProposals).where(eq(skillProposals.sessionId, sessionId)).orderBy(desc(skillProposals.createdAt))
}

export async function findSkillProposalByFingerprint(agentId: string, fingerprint: string): Promise<SkillProposalRow | undefined> {
    const { db } = await getSystemDb(agentId)
    const rows = await db
        .select()
        .from(skillProposals)
        .where(and(eq(skillProposals.agentId, agentId), like(skillProposals.fingerprintsJson, `%"${fingerprint}"%`)))
        .limit(1)
    return rows[0]
}

export async function openSkillProposalForSession(agentId: string, sessionId: string): Promise<SkillProposalRow | undefined> {
    const { db } = await getSystemDb(agentId)
    const rows = await db
        .select()
        .from(skillProposals)
        .where(and(eq(skillProposals.sessionId, sessionId), eq(skillProposals.status, 'proposed')))
        .orderBy(desc(skillProposals.createdAt))
        .limit(1)
    return rows[0]
}

export async function appendSkillProposalInstruction(
    agentId: string,
    id: string,
    input: SkillProposalModel & { instruction: string; title: string; summary: string; fingerprint: string }
): Promise<SkillProposalRow | undefined> {
    const current = await getSkillProposal(agentId, id)
    if (!current || current.status !== 'proposed') return undefined
    const instructions = [...(JSON.parse(current.instructionsJson) as string[]), input.instruction]
    const fingerprints = [...(JSON.parse(current.fingerprintsJson) as string[]), input.fingerprint]
    const patch = {
        instructionsJson: JSON.stringify(instructions),
        fingerprintsJson: JSON.stringify(fingerprints),
        title: input.title,
        summary: input.summary,
        connectionId: input.connectionId,
        provider: input.provider,
        model: input.model,
    }
    const { db } = await getSystemDb(agentId)
    await db.update(skillProposals).set(patch).where(eq(skillProposals.id, id))
    return { ...current, ...patch }
}

export async function transitionSkillProposal(
    agentId: string,
    id: string,
    from: SkillProposalStatus[],
    to: SkillProposalStatus,
    patch: { appliedSlug?: string | null; error?: string | null } = {}
): Promise<boolean> {
    const { db } = await getSystemDb(agentId)
    const updated = await db
        .update(skillProposals)
        .set({ status: to, decidedAt: nowIso(), ...patch })
        .where(and(eq(skillProposals.id, id), inArray(skillProposals.status, from)))
        .returning({ id: skillProposals.id })
    return updated.length > 0
}

export async function failInterruptedSkillProposals(agentId: string): Promise<number> {
    const { db } = await getSystemDb(agentId)
    const failed = await db
        .update(skillProposals)
        .set({ status: 'failed', decidedAt: nowIso(), error: 'interrupted: engine restarted' })
        .where(eq(skillProposals.status, 'accepted'))
        .returning({ id: skillProposals.id })
    return failed.length
}
