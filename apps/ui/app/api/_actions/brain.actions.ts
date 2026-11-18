'use server'

import { actorFromContext, visibleSpaceIds } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { requireWorkspaceConnection } from '@/app/api/_auth/workspace-target'
import { syncCoworkerBoxes } from '@/app/api/_services/coworker-box.service'
import { getWorkspaceConnection, NoEngineError } from '@/app/api/_services/workspace-engine.service'
import * as engine from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import type { BrainBox, BrainCoworker } from '@/lib/brain/items'
import { selectMany } from '@/supabase/supabase-helpers'
import { brainFilesMetaWriteSchema, brainItemMetaPatchSchema, type BrainFileMeta, type BrainItemMetaPatch, type BrainPageSummary, type BrainPageType, type BrainProposal, type BrainRevision } from '@rerun/contracts'
import { failureOf, refusal, refusalOf, type ActionFailure, type ActionRefusal } from '@/lib/i18n/action-error'

// A box that predates the brain answers 404 on every /brain route: the dialog shows an "update
// your box" state rather than an error.
const isMissingRoute = (err: unknown) => err instanceof engine.EngineRequestError && err.status === 404

// Every write names a person in the page history; the engine has no users of its own.
async function authorContext() {
    const ctx = await requireWorkspaceContext()
    return { conn: await getWorkspaceConnection(ctx.workspace.id), author: `user:${ctx.userEmail ?? ctx.userId}` }
}

// A workspace gets its machine when its first coworker is built: until then, an onboarding user who
// opens the Brain reaches a workspace with nowhere to keep it.
export type BrainOverview =
    | { available: true; pages: BrainPageSummary[]; openProposals: number; boxes: BrainBox[]; coworkers: BrainCoworker[]; files: BrainFileMeta[] }
    | { available: false; reason: 'no_machine' | 'outdated' }

// The Boxes the person can open, in the order of the sidebar, and the coworkers sitting in them: a
// Box they cannot open stays out of the Brain's list, and its items read as filed for everyone.
async function readBoxes(): Promise<{ boxes: BrainBox[]; coworkers: BrainCoworker[]; workspaceId: number }> {
    const ctx = await requireWorkspaceContext()
    const visible = await visibleSpaceIds(actorFromContext(ctx))
    const [spaces, agents] = await Promise.all([
        selectMany(ctx.supabase, 'spaces', ['id', 'name', 'sidebar_order', 'created_at'] as const, { workspace_id: ctx.workspace.id }),
        selectMany(ctx.supabase, 'agents', ['id', 'name', 'handle', 'space_id', 'engine_agent_id'] as const, { workspace_id: ctx.workspace.id }),
    ])
    const canSee = (spaceId: string) => visible === 'all' || visible.has(spaceId)
    const boxes = (spaces.data ?? [])
        .filter(space => canSee(space.id))
        .sort((a, b) => (a.sidebar_order ?? Number.MAX_SAFE_INTEGER) - (b.sidebar_order ?? Number.MAX_SAFE_INTEGER) || (a.created_at ?? '').localeCompare(b.created_at ?? ''))
        .map(space => ({ id: space.id, name: space.name?.trim() || null }))
    const coworkers = (agents.data ?? []).filter(agent => canSee(agent.space_id)).map(agent => ({ id: agent.id, name: agent.name, handle: agent.handle ?? null, spaceId: agent.space_id }))
    return { boxes, coworkers, workspaceId: ctx.workspace.id }
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
        const [pages, openProposals, files, { boxes, coworkers, workspaceId }] = await Promise.all([engine.listBrainPages(conn), engine.countBrainProposals(conn), readFileMeta(conn), readBoxes()])
        await syncCoworkerBoxes(workspaceId)
        return { available: true, pages, openProposals, boxes, coworkers, files }
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

export async function saveBrainPageAction(slug: string, input: BrainPageInput): Promise<BrainWriteResult> {
    try {
        const { conn, author } = await authorContext()
        return { ok: true, detail: await engine.writeBrainPage(conn, slug, { ...input, author }) }
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
