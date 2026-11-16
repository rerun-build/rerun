import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-proposals-'))

const { beforeAll, describe, expect, it } = await import('vitest')
const { serializeApprovalDecisions } = await import('@rerun/contracts')
const { migrate } = await import('../migrate.js')
const { ensureForeman } = await import('../../agents/foreman.js')
const { decideProposals, proposalsToRemember, recordProposals } = await import('./proposals.js')

const card = (toolCallId: string, sessionId: string, approvals: unknown, over: Record<string, unknown> = {}) => ({ toolCallId, input: { title: 'Scout is failing', approvals, ...over }, sessionId, runId: 'r1', memberId: 'member-1', fromWake: true })

beforeAll(async () => {
    await migrate()
    await ensureForeman()
})

describe('foreman proposals', () => {
    it('remembers each action of a card under its topic, then reads the decisions in the card order', async () => {
        await recordProposals(card('c1', 's1', [{ action: 'Reconnect Gmail for Scout', topic: 'Scout Gmail' }, { action: 'Pause the weekly report', topic: 'weekly report' }]))
        const text = serializeApprovalDecisions([
            { action: 'Reconnect Gmail for Scout', decision: 'approved' },
            { action: 'Pause the weekly report', decision: 'declined', note: 'I still read it' },
        ])
        await decideProposals('s1', text)
        const remembered = (await proposalsToRemember()).filter(p => p.sessionId === 's1')
        expect(remembered.map(p => [p.topic, p.status, p.note])).toEqual(
            expect.arrayContaining([
                ['Scout Gmail', 'accepted', null],
                ['weekly report', 'declined', 'I still read it'],
            ]),
        )
        expect(remembered.every(p => p.fromWake && p.title === 'Scout is failing')).toBe(true)
    })

    it('marks a card answered when they wrote something else', async () => {
        await recordProposals(card('c2', 's2', [{ action: 'Add a routine' }]))
        await decideProposals('s2', 'Not now, ask me Monday')
        const [proposal] = (await proposalsToRemember()).filter(p => p.sessionId === 's2')
        expect(proposal).toMatchObject({ status: 'answered', note: 'Not now, ask me Monday' })
    })

    // A CLI sometimes sends the array as its JSON text.
    it('reads approvals sent as a JSON string, and records nothing for an empty card', async () => {
        await recordProposals(card('c3', 's3', JSON.stringify([{ action: 'Invite Ada', topic: 'team' }])))
        await recordProposals(card('c4', 's4', []))
        const sessions = (await proposalsToRemember()).map(p => p.sessionId)
        expect(sessions).toContain('s3')
        expect(sessions).not.toContain('s4')
    })

    it('expires an open proposal after two weeks, in the log only', async () => {
        await recordProposals(card('c5', 's5', [{ action: 'Old idea' }]), new Date('2026-10-01T10:00:00Z'))
        const [old] = (await proposalsToRemember(new Date('2026-10-20T10:00:00Z'))).filter(p => p.sessionId === 's5')
        expect(old.status).toBe('expired')
    })

    it('records a card once, however often its turn is settled', async () => {
        await recordProposals(card('c6', 's6', [{ action: 'Once' }]))
        await recordProposals(card('c6', 's6', [{ action: 'Once' }]))
        expect((await proposalsToRemember()).filter(p => p.sessionId === 's6')).toHaveLength(1)
    })
})
