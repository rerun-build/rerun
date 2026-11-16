import { FOREMAN_AGENT_ID, parseApprovalDecisions } from '@rerun/contracts'
import { getSystemDb } from '../systemDb.js'

// What the Chief of Staff proposed, action by action, and what came of it. Written when a turn ends on
// its request_approval card, decided when the next turn of that conversation starts, so a wake knows
// what is still open and what was declined.

export type ProposalStatus = 'open' | 'accepted' | 'declined' | 'answered' | 'expired'

export type Proposal = {
    id: string
    sessionId: string
    topic: string | null
    title: string | null
    action: string
    status: ProposalStatus
    note: string | null
    fromWake: boolean
    createdAt: string
    decidedAt: string | null
}

const EXPIRE_AFTER_MS = 14 * 24 * 60 * 60 * 1000
const RECENT_MS = 30 * 24 * 60 * 60 * 1000

function text(value: unknown, max: number): string | null {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

// A CLI model sometimes sends the array as its JSON text.
function approvalsOf(input: Record<string, unknown>): Array<Record<string, unknown>> {
    let approvals = input.approvals
    if (typeof approvals === 'string') {
        try {
            approvals = JSON.parse(approvals)
        } catch {
            return []
        }
    }
    return Array.isArray(approvals) ? approvals.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object') : []
}

export type ProposalCard = { toolCallId: string; input: unknown; sessionId: string; runId: string; memberId: string | null; fromWake: boolean }

export async function recordProposals(card: ProposalCard, now = new Date()): Promise<void> {
    const input = (card.input ?? {}) as Record<string, unknown>
    const title = text(input.title, 80)
    const rows = approvalsOf(input).flatMap((item, index) => {
        const action = text(item.action, 300)
        return action ? [{ id: `${card.toolCallId}:${index}`, action, detail: text(item.detail, 1000), topic: text(item.topic, 80) }] : []
    })
    if (!rows.length) return
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    await client.batch(
        rows.map(row => ({
            sql: 'INSERT OR IGNORE INTO foreman_proposals (id, session_id, run_id, member_id, topic, title, action, detail, status, from_wake, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            args: [row.id, card.sessionId, card.runId, card.memberId, row.topic, title, row.action, row.detail, 'open', card.fromWake ? 1 : 0, now.toISOString()],
        })),
    )
}

// The next message in the conversation answers the card: the decisions the approval block sends, in
// the card's order, or anything else they wrote instead.
export async function decideProposals(sessionId: string, userText: string, now = new Date()): Promise<void> {
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    const open = await client.execute({ sql: "SELECT id FROM foreman_proposals WHERE session_id = ? AND status = 'open' ORDER BY created_at, id", args: [sessionId] })
    if (!open.rows.length) return
    const ids = open.rows.map(row => String(row.id))
    const decisions = parseApprovalDecisions(userText)
    const decidedAt = now.toISOString()
    if (!decisions) {
        await client.batch(ids.map(id => ({ sql: "UPDATE foreman_proposals SET status = 'answered', note = ?, decided_at = ? WHERE id = ?", args: [userText.trim().slice(0, 300), decidedAt, id] })))
        return
    }
    const byIndex = (id: string) => Number(id.slice(id.lastIndexOf(':') + 1))
    await client.batch(
        ids.map(id => {
            const decision = decisions[byIndex(id)]
            if (!decision) return { sql: "UPDATE foreman_proposals SET status = 'answered', decided_at = ? WHERE id = ?", args: [decidedAt, id] }
            return { sql: 'UPDATE foreman_proposals SET status = ?, note = ?, decided_at = ? WHERE id = ?', args: [decision.decision === 'approved' ? 'accepted' : 'declined', decision.note ?? null, decidedAt, id] }
        }),
    )
}

function toProposal(row: Record<string, unknown>): Proposal {
    return {
        id: String(row.id),
        sessionId: String(row.session_id),
        topic: (row.topic as string | null) ?? null,
        title: (row.title as string | null) ?? null,
        action: String(row.action),
        status: String(row.status) as ProposalStatus,
        note: (row.note as string | null) ?? null,
        fromWake: Number(row.from_wake) === 1,
        createdAt: String(row.created_at),
        decidedAt: (row.decided_at as string | null) ?? null,
    }
}

// What a wake reads: what is still open, and what was decided in the last thirty days. An open one
// past two weeks is expired here, in this log only: the conversation keeps its card.
export async function proposalsToRemember(now = new Date()): Promise<Proposal[]> {
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    await client.execute({ sql: "UPDATE foreman_proposals SET status = 'expired', decided_at = ? WHERE status = 'open' AND created_at < ?", args: [now.toISOString(), new Date(now.getTime() - EXPIRE_AFTER_MS).toISOString()] })
    const rs = await client.execute({ sql: "SELECT * FROM foreman_proposals WHERE status = 'open' OR decided_at >= ? ORDER BY created_at DESC LIMIT 40", args: [new Date(now.getTime() - RECENT_MS).toISOString()] })
    return rs.rows.map(row => toProposal(row as unknown as Record<string, unknown>))
}
