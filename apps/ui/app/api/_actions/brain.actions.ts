'use server'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { requireWorkspaceConnection } from '@/app/api/_auth/workspace-target'
import { getWorkspaceConnection, NoEngineError } from '@/app/api/_services/workspace-engine.service'
import * as engine from '@/lib/engine/client'
import type { BrainPageSummary, BrainPageType, BrainProposal, BrainRevision } from '@moldwright/contracts'
import { failureOf, refusal, refusalOf, type ActionFailure, type ActionRefusal } from '@/lib/i18n/action-error'

const isMissingRoute = (err: unknown) => err instanceof engine.EngineRequestError && err.status === 404

async function authorContext() {
    const ctx = await requireWorkspaceContext()
    return { conn: await getWorkspaceConnection(ctx.workspace.id), author: `user:${ctx.userEmail ?? ctx.userId}` }
}

export type BrainOverview = { available: true; pages: BrainPageSummary[]; openProposals: number } | { available: false; reason: 'no_machine' | 'outdated' }

export async function loadBrainAction(): Promise<BrainOverview> {
    try {
        const conn = await requireWorkspaceConnection()
        const [pages, openProposals] = await Promise.all([engine.listBrainPages(conn), engine.countBrainProposals(conn)])
        return { available: true, pages, openProposals }
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
