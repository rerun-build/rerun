'use server'

import { actorFromContext, manageableSpaceIds, visibleSpaceIds } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { brainAuthorOf } from '@/app/api/_auth/signature'
import { requireWorkspaceConnection } from '@/app/api/_auth/workspace-target'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { syncCoworkerBoxes } from '@/app/api/_services/coworker-box.service'
import { getWorkspaceConnection, NoEngineError } from '@/app/api/_services/workspace-engine.service'
import * as engine from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import type { BrainBox, BrainCoworker } from '@/lib/brain/items'
import { connectorSkillSlugs, readRegistry } from '@/lib/services/registry'
import { selectMany } from '@/supabase/supabase-helpers'
import { brainFilesMetaWriteSchema, brainItemMetaPatchSchema, type BrainFileMeta, type BrainItemMetaPatch, type BrainPageSummary, type BrainPageType, type BrainProposal, type BrainRevision, type BrainSkill, type SkillSummary } from '@rerun/contracts'
import { failure, failureOf, refusal, refusalOf, type ActionFailure, type ActionRefusal } from '@/lib/i18n/action-error'
import { sitsInABox } from '@/lib/agents/in-box'

// A box that predates the brain answers 404 on every /brain route: the dialog shows an "update
// your box" state rather than an error.
const isMissingRoute = (err: unknown) => err instanceof engine.EngineRequestError && err.status === 404

async function authorContext() {
    const ctx = await requireWorkspaceContext()
    const [conn, author] = await Promise.all([getWorkspaceConnection(ctx.workspace.id), brainAuthorOf({ ...ctx, email: ctx.userEmail })])
    return { conn, author }
}

// A workspace gets its machine when its first coworker is built: until then, an onboarding user who
// opens the Brain reaches a workspace with nowhere to keep it.
export type BrainOverview =
    | { available: true; pages: BrainPageSummary[]; openProposals: number; boxes: BrainBox[]; coworkers: BrainCoworker[]; files: BrainFileMeta[]; skills: BrainSkill[]; skillsAvailable: boolean }
    | { available: false; reason: 'no_machine' | 'outdated' }

// The Boxes the person can open, in the order of the sidebar, and the coworkers sitting in them: a
// Box they cannot open stays out of the Brain's list, and its items read as filed for everyone.
async function readBoxes(): Promise<{ boxes: BrainBox[]; coworkers: BrainCoworker[]; engineAgentIds: Map<string, string>; workspaceId: number }> {
    const ctx = await requireWorkspaceContext()
    const visible = await visibleSpaceIds(actorFromContext(ctx))
    const [spaces, agents] = await Promise.all([
        selectMany(ctx.supabase, 'spaces', ['id', 'name', 'sidebar_order', 'created_at'] as const, { workspace_id: ctx.workspace.id }),
        selectMany(ctx.supabase, 'agents', ['id', 'name', 'handle', 'space_id', 'engine_agent_id'] as const, { workspace_id: ctx.workspace.id, kind: 'coworker' }),
    ])
    const canSee = (spaceId: string) => visible === 'all' || visible.has(spaceId)
    const boxes = (spaces.data ?? [])
        .filter(space => canSee(space.id))
        .sort((a, b) => (a.sidebar_order ?? Number.MAX_SAFE_INTEGER) - (b.sidebar_order ?? Number.MAX_SAFE_INTEGER) || (a.created_at ?? '').localeCompare(b.created_at ?? ''))
        .map(space => ({ id: space.id, name: space.name?.trim() || null }))
    const seen = (agents.data ?? []).filter(sitsInABox).filter(agent => canSee(agent.space_id))
    const coworkers = seen.map(agent => ({ id: agent.id, name: agent.name, handle: agent.handle ?? null, spaceId: agent.space_id }))
    const engineAgentIds = new Map(seen.flatMap(agent => (agent.engine_agent_id ? [[agent.id, agent.engine_agent_id] as const] : [])))
    return { boxes, coworkers, engineAgentIds, workspaceId: ctx.workspace.id }
}

// An engine from before filing answers 404 here: its files read as unfiled.
async function readFileMeta(conn: EngineConnection): Promise<BrainFileMeta[]> {
    try {
        return await engine.listBrainFileMeta(conn)
    } catch (err) {
        if (isMissingRoute(err)) return []
        throw err
    }
}

// An engine from before the Brain's skills answers 404 here: null, so nothing offers to write one.
async function readBrainSkills(conn: EngineConnection): Promise<BrainSkill[] | null> {
    try {
        return await engine.listBrainSkills(conn)
    } catch (err) {
        if (isMissingRoute(err)) return null
        throw err
    }
}

// Read again as the files of an import land: they are filed before their bytes arrive.
export async function listBrainFileMetaAction(): Promise<BrainFileMeta[] | null> {
    try {
        return await readFileMeta(await requireWorkspaceConnection())
    } catch {
        return null
    }
}

export async function loadBrainAction(): Promise<BrainOverview> {
    try {
        const conn = await requireWorkspaceConnection()
        const [pages, openProposals, files, skills, { boxes, coworkers, workspaceId }] = await Promise.all([
            engine.listBrainPages(conn),
            engine.countBrainProposals(conn),
            readFileMeta(conn),
            readBrainSkills(conn),
            readBoxes(),
        ])
        await syncCoworkerBoxes(workspaceId)
        return { available: true, pages, openProposals, boxes, coworkers, files, skills: skills ?? [], skillsAvailable: skills !== null }
    } catch (err) {
        if (err instanceof NoEngineError) return { available: false, reason: 'no_machine' }
        if (isMissingRoute(err)) return { available: false, reason: 'outdated' }
        throw err
    }
}

export async function readBrainPageAction(slug: string): Promise<engine.BrainPageDetail | null> {
    const conn = await requireWorkspaceConnection()
    try {
        return await engine.readBrainPage(conn, slug)
    } catch (err) {
        if (isMissingRoute(err)) return null
        throw err
    }
}

export type BrainPageInput = { title: string; type: BrainPageType; content: string; sources: string[]; baseHash: string | null }

export type BrainWriteResult = { ok: true; detail: engine.BrainPageDetail } | (ActionFailure & { conflict: boolean })

// A new page written from a Box is filed under it right after: the engine's write takes no Box, and
// filing it through its own route works on every engine already out there. A filing that fails
// leaves the page written, under Everyone, where its Box property moves it in one click.
export async function saveBrainPageAction(slug: string, input: BrainPageInput, filing?: { spaceId: string }): Promise<BrainWriteResult> {
    try {
        const { conn, author } = await authorContext()
        const detail = await engine.writeBrainPage(conn, slug, { ...input, author })
        if (!filing) return { ok: true, detail }
        try {
            return { ok: true, detail: await engine.setBrainPageMeta(conn, slug, brainItemMetaPatchSchema.parse(filing)) }
        } catch {
            return { ok: true, detail }
        }
    } catch (err) {
        const conflict = err instanceof engine.EngineRequestError && err.status === 409
        return { ok: false, conflict, ...(conflict ? refusal('brainPageConflict') : refusalOf(err, 'saveBrainPageFailed')) }
    }
}

export type BrainMetaResult<T> = { ok: true; value: T } | ActionFailure

export async function setBrainPageMetaAction(slug: string, patch: BrainItemMetaPatch): Promise<BrainMetaResult<engine.BrainPageDetail>> {
    try {
        const conn = await requireWorkspaceConnection()
        return { ok: true, value: await engine.setBrainPageMeta(conn, slug, brainItemMetaPatchSchema.parse(patch)) }
    } catch (err) {
        return failureOf(err, 'fileBrainItemFailed')
    }
}

// Files the given paths of the shared folder; the person becomes the author of the ones not filed yet.
export async function setBrainFilesMetaAction(input: { paths: string[] } & BrainItemMetaPatch): Promise<BrainMetaResult<BrainFileMeta[]>> {
    try {
        const { conn, author } = await authorContext()
        return { ok: true, value: await engine.setBrainFileMeta(conn, brainFilesMetaWriteSchema.parse({ ...input, author })) }
    } catch (err) {
        return failureOf(err, 'fileBrainItemFailed')
    }
}

export async function deleteBrainPageAction(slug: string): Promise<{ ok: boolean } & Partial<ActionRefusal>> {
    try {
        await engine.deleteBrainPage(await requireWorkspaceConnection(), slug)
        return { ok: true }
    } catch (err) {
        return { ok: false, ...refusalOf(err, 'deleteBrainPageFailed') }
    }
}

export async function readBrainRevisionAction(slug: string, revisionId: string): Promise<{ revision: BrainRevision; content: string } | null> {
    try {
        return await engine.readBrainRevision(await requireWorkspaceConnection(), slug, revisionId)
    } catch {
        return null
    }
}

export async function revertBrainPageAction(slug: string, revisionId: string, expectedHash?: string): Promise<BrainWriteResult> {
    try {
        const { conn, author } = await authorContext()
        return { ok: true, detail: await engine.revertBrainPage(conn, slug, revisionId, author, expectedHash) }
    } catch (err) {
        const conflict = err instanceof engine.EngineRequestError && err.status === 409
        return { ok: false, conflict, ...(conflict ? refusal('brainPageChangedSince') : refusalOf(err, 'restoreVersionFailed')) }
    }
}

export async function confirmBrainSectionsAction(slug: string, headings: string[] | null): Promise<BrainWriteResult> {
    try {
        return { ok: true, detail: await engine.confirmBrainSections(await requireWorkspaceConnection(), slug, headings) }
    } catch (err) {
        return { ok: false, conflict: false, ...refusalOf(err, 'confirmBrainPageFailed') }
    }
}

export async function listBrainProposalsAction(): Promise<BrainProposal[]> {
    try {
        return await engine.listBrainProposals(await requireWorkspaceConnection(), 'proposed')
    } catch (err) {
        if (err instanceof NoEngineError || isMissingRoute(err)) return []
        throw err
    }
}

// Polled from the workspace menu, so it never throws: no box, an old box or a box that is down
// all read as nothing to review.
export async function countBrainProposalsAction(): Promise<number> {
    try {
        return await engine.countBrainProposals(await requireWorkspaceConnection())
    } catch {
        return 0
    }
}

export type BrainProposalEdits = { title?: string; type?: BrainPageType; content?: string }

export async function decideBrainProposalAction(
    proposalId: string,
    decision: 'accept' | 'dismiss',
    edits: BrainProposalEdits = {}
): Promise<{ ok: true; proposal: BrainProposal } | ActionFailure> {
    try {
        const { conn, author } = await authorContext()
        const proposal = await engine.decideBrainProposal(conn, proposalId, decision, decision === 'accept' ? { ...edits, decidedBy: author } : { decidedBy: author })
        return { ok: true, proposal }
    } catch (err) {
        return failureOf(err, 'updateBrainProposalFailed')
    }
}

// --- Skills of the Brain ---
// Every coworker of the box uses them. Writing one takes what writing a page takes; sharing a
// coworker's own skill takes managing that coworker, since the skill leaves its folder.

export type BrainSkillResult = { ok: true; skill: BrainSkill } | ActionFailure

const isConflict = (err: unknown) => err instanceof engine.EngineRequestError && err.status === 409

// For a coworker's Skills tab: the Brain's skills and the coworkers who put them there. `available`
// is false on an engine from before them.
export async function listBrainSkillsAction(): Promise<{ available: boolean; skills: BrainSkill[]; coworkers: BrainCoworker[] } | null> {
    try {
        const [skills, { coworkers }] = await Promise.all([readBrainSkills(await requireWorkspaceConnection()), readBoxes()])
        return { available: skills !== null, skills: skills ?? [], coworkers }
    } catch {
        return null
    }
}

export async function createBrainSkillAction(input: { name: string; description: string; body: string }): Promise<BrainSkillResult> {
    try {
        const { conn, author } = await authorContext()
        return { ok: true, skill: await engine.createBrainSkill(conn, { ...input, author }) }
    } catch (err) {
        return isConflict(err) ? failure('brainSkillExists', { name: input.name }) : failureOf(err, 'saveBrainSkillFailed')
    }
}

export async function updateBrainSkillAction(slug: string, patch: { description?: string; body?: string }): Promise<BrainSkillResult> {
    try {
        return { ok: true, skill: await engine.updateBrainSkill(await requireWorkspaceConnection(), slug, patch) }
    } catch (err) {
        return failureOf(err, 'saveBrainSkillFailed')
    }
}

export async function deleteBrainSkillAction(slug: string): Promise<{ ok: boolean } & Partial<ActionRefusal>> {
    try {
        await engine.deleteBrainSkill(await requireWorkspaceConnection(), slug)
        return { ok: true }
    } catch (err) {
        return { ok: false, ...refusalOf(err, 'deleteBrainSkillFailed') }
    }
}

// What each coworker the person can see holds of its own, apps' skills left out: they stay the app's.
export type ShareableSkills = { coworker: BrainCoworker; canShare: boolean; skills: SkillSummary[] }

export async function listShareableSkillsAction(): Promise<ShareableSkills[]> {
    try {
        const ctx = await requireWorkspaceContext()
        const [conn, { coworkers, engineAgentIds }, manageable] = await Promise.all([requireWorkspaceConnection(), readBoxes(), manageableSpaceIds(actorFromContext(ctx))])
        const lists = await Promise.all(
            coworkers.map(async coworker => {
                const engineAgentId = engineAgentIds.get(coworker.id)
                if (!engineAgentId) return null
                const read = await Promise.all([engine.listSkills(conn, engineAgentId), readRegistry(conn, engineAgentId)]).catch(() => null)
                if (!read) return null
                const [skills, registry] = read
                const fromApps = connectorSkillSlugs(registry)
                const own = skills.filter(skill => !fromApps.has(skill.slug)).map(({ slug, name, description }) => ({ slug, name, description }))
                const canShare = manageable === 'all' || manageable.has(coworker.spaceId)
                return own.length > 0 ? { coworker, canShare, skills: own } : null
            })
        )
        return lists.filter(list => list !== null)
    } catch {
        return []
    }
}

export async function shareSkillToBrainAction(agentId: string, slug: string): Promise<BrainSkillResult> {
    try {
        const { conn, engineAgentId } = await resolveAgentTarget(agentId, 'manage')
        const { coworkers } = await readBoxes()
        const coworker = coworkers.find(item => item.id === agentId)
        const author = `agent:${coworker?.handle ?? coworker?.name ?? engineAgentId}`
        return { ok: true, skill: await engine.shareSkillToBrain(conn, engineAgentId, slug, author) }
    } catch (err) {
        return isConflict(err) ? failure('brainSkillShareTaken', { slug }) : failureOf(err, 'shareBrainSkillFailed')
    }
}
