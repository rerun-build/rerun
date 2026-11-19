import { createHash } from 'node:crypto'
import type { BrainPageType, BrainProposal, BrainProposalAccept, BrainProposalHighlight, BrainProposalStatus } from '@moldwright/contracts'
import { getBrainDb } from '../db/brainDb.js'
import { notFound } from '../lib/errors.js'
import { newId, nowIso } from '../lib/ids.js'
import { readPageFile, writePage, type BrainPageFile } from './pages.js'

export type ProposalRow = {
    id: string
    agentId: string
    agentName: string
    sessionId: string
    slug: string
    mode: 'create' | 'edit'
    title: string
    headline: string | null
    highlights: BrainProposalHighlight[]
    type: BrainPageType
    content: string
    reason: string
    sources: string[]
    baseHash: string | null
    fingerprint: string
    status: BrainProposalStatus
    createdAt: string
    decidedAt: string | null
    decidedBy: string | null
}

export type InsertProposal = Omit<ProposalRow, 'id' | 'status' | 'createdAt' | 'decidedAt' | 'decidedBy'>

export function proposalFingerprint(input: { slug: string; content: string }): string {
    const normalized = input.content.toLowerCase().normalize('NFKD').replace(/\s+/g, ' ').trim()
    return createHash('sha256').update(`${input.slug}|${normalized}`).digest('hex').slice(0, 32)
}

function toRow(r: Record<string, unknown>): ProposalRow {
    return {
        id: String(r.id),
        agentId: String(r.agent_id),
        agentName: String(r.agent_name),
        sessionId: String(r.session_id),
        slug: String(r.slug),
        mode: r.mode === 'edit' ? 'edit' : 'create',
        title: String(r.title),
        headline: r.headline == null ? null : String(r.headline),
        highlights: r.highlights_json == null ? [] : (JSON.parse(String(r.highlights_json)) as BrainProposalHighlight[]),
        type: r.type as BrainPageType,
        content: String(r.content),
        reason: String(r.reason),
        sources: JSON.parse(String(r.sources_json)) as string[],
        baseHash: r.base_hash == null ? null : String(r.base_hash),
        fingerprint: String(r.fingerprint),
        status: r.status as BrainProposalStatus,
        createdAt: String(r.created_at),
        decidedAt: r.decided_at == null ? null : String(r.decided_at),
        decidedBy: r.decided_by == null ? null : String(r.decided_by),
    }
}

export function toBrainProposal(row: ProposalRow, current: BrainPageFile | null): BrainProposal {
    const outdated = row.status === 'proposed' && (row.mode === 'edit' ? current?.hash !== row.baseHash : current !== null)
    const { fingerprint: _fingerprint, ...rest } = row
    return { ...rest, outdated, currentContent: current?.content ?? null }
}

export async function insertProposal(input: InsertProposal): Promise<ProposalRow> {
    const row: ProposalRow = { ...input, id: newId(), status: 'proposed', createdAt: nowIso(), decidedAt: null, decidedBy: null }
    const client = await getBrainDb()
    await client.execute({
        sql: `INSERT INTO brain_proposals(id, agent_id, agent_name, session_id, slug, mode, title, headline, highlights_json, type, content, reason, sources_json, base_hash, fingerprint, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.id, row.agentId, row.agentName, row.sessionId, row.slug, row.mode, row.title, row.headline, JSON.stringify(row.highlights), row.type, row.content, row.reason, JSON.stringify(row.sources), row.baseHash, row.fingerprint, row.status, row.createdAt],
    })
    return row
}

export async function replaceOpenProposal(id: string, input: InsertProposal): Promise<void> {
    const client = await getBrainDb()
    await client.execute({
        sql: `UPDATE brain_proposals SET session_id = ?, mode = ?, title = ?, headline = ?, highlights_json = ?, type = ?, content = ?, reason = ?, sources_json = ?, base_hash = ?, fingerprint = ?, created_at = ?
              WHERE id = ? AND status = 'proposed'`,
        args: [input.sessionId, input.mode, input.title, input.headline, JSON.stringify(input.highlights), input.type, input.content, input.reason, JSON.stringify(input.sources), input.baseHash, input.fingerprint, nowIso(), id],
    })
}

export async function getProposal(id: string): Promise<ProposalRow | null> {
    const client = await getBrainDb()
    const rs = await client.execute({ sql: 'SELECT * FROM brain_proposals WHERE id = ?', args: [id] })
    return rs.rows[0] ? toRow(rs.rows[0]) : null
}

export async function findProposalByFingerprint(fingerprint: string): Promise<ProposalRow | null> {
    const client = await getBrainDb()
    const rs = await client.execute({ sql: 'SELECT * FROM brain_proposals WHERE fingerprint = ? LIMIT 1', args: [fingerprint] })
    return rs.rows[0] ? toRow(rs.rows[0]) : null
}

export async function openProposalFor(agentId: string, slug: string): Promise<ProposalRow | null> {
    const client = await getBrainDb()
    const rs = await client.execute({
        sql: "SELECT * FROM brain_proposals WHERE agent_id = ? AND slug = ? AND status = 'proposed' ORDER BY created_at DESC LIMIT 1",
        args: [agentId, slug],
    })
    return rs.rows[0] ? toRow(rs.rows[0]) : null
}

export async function renameProposalAuthor(agentId: string, agentName: string): Promise<void> {
    const client = await getBrainDb()
    await client.execute({ sql: 'UPDATE brain_proposals SET agent_name = ? WHERE agent_id = ?', args: [agentName, agentId] })
}

export async function listProposals(status?: BrainProposalStatus, limit = 100): Promise<BrainProposal[]> {
    const client = await getBrainDb()
    const rs = status
        ? await client.execute({ sql: 'SELECT * FROM brain_proposals WHERE status = ? ORDER BY created_at DESC LIMIT ?', args: [status, limit] })
        : await client.execute({ sql: 'SELECT * FROM brain_proposals ORDER BY created_at DESC LIMIT ?', args: [limit] })
    const rows = rs.rows.map(toRow)
    const current = new Map<string, BrainPageFile | null>()
    for (const slug of new Set(rows.map(r => r.slug))) current.set(slug, await readPageFile(slug))
    return rows.map(r => toBrainProposal(r, current.get(r.slug) ?? null))
}

export async function countOpenProposals(): Promise<number> {
    const client = await getBrainDb()
    const rs = await client.execute("SELECT COUNT(*) AS n FROM brain_proposals WHERE status = 'proposed'")
    return Number(rs.rows[0]?.n ?? 0)
}

async function transition(id: string, from: BrainProposalStatus[], to: BrainProposalStatus, decidedBy: string | null): Promise<boolean> {
    const client = await getBrainDb()
    const rs = await client.execute({
        sql: `UPDATE brain_proposals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status IN (${from.map(() => '?').join(', ')}) RETURNING id`,
        args: [to, decidedBy ? nowIso() : null, decidedBy, id, ...from],
    })
    return rs.rows.length > 0
}

async function decided(id: string): Promise<BrainProposal> {
    const row = await getProposal(id)
    if (!row) throw notFound('proposal')
    return toBrainProposal(row, await readPageFile(row.slug))
}

export async function acceptProposal(id: string, decidedBy: string, edits: Omit<BrainProposalAccept, 'decidedBy'> = {}): Promise<BrainProposal> {
    const row = await getProposal(id)
    if (!row) throw notFound('proposal')
    if (!(await transition(id, ['proposed'], 'accepted', decidedBy))) return decided(id)
    try {
        await writePage(row.slug, {
            title: edits.title ?? row.title,
            type: edits.type ?? row.type,
            content: edits.content ?? row.content,
            sources: row.sources,
            baseHash: null,
            force: true,
            author: `agent:${row.agentName}`,
            proposalId: row.id,
        })
    } catch (err) {
        await transition(id, ['accepted'], 'proposed', null)
        throw err
    }
    return decided(id)
}

export async function dismissProposal(id: string, decidedBy: string): Promise<BrainProposal> {
    await transition(id, ['proposed'], 'dismissed', decidedBy)
    return decided(id)
}
