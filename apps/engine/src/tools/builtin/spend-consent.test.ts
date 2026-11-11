import { describe, expect, it, vi, beforeEach } from 'vitest'
import { HITL_CANCELLED, serializeAnswers, serializeSpendDecision } from '@rerun/contracts'

const stored = vi.hoisted(() => ({ rows: [] as { role: string; contentJson: string }[], reads: 0 }))

vi.mock('../../db/repos/messages.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../db/repos/messages.js')>()),
    listMessages: async () => {
        stored.reads += 1
        return stored.rows
    },
}))

const { checkSpendConsent, findSpendApproval, recordSpend, SPEND_OVERRUN_FACTOR } = await import('./spend-consent.js')

const PURPOSE = 'Find the emails of 40 restaurant owners'

let callSeq = 0

// The request as the engine stores it: the call in the assistant turn, the hub's quote in the tool
// result that follows.
function spendRequest(totalMicros = 2_000_000, toolName = 'request_spend', line: Record<string, string> = { capability: 'people.email.find' }) {
    const toolCallId = `spend-${++callSeq}`
    const call = { role: 'assistant', contentJson: JSON.stringify([{ type: 'text', text: 'Here is the plan.' }, { type: 'tool-call', toolCallId, toolName, input: { purpose: PURPOSE, calls: [{ ...line, count: 40 }] } }]) }
    const quote = { totalMicros, lines: [{ ...line, count: 40, units: 40, micros: totalMicros }], creditLeftMicros: 7_000_000 }
    const result = { role: 'tool', contentJson: JSON.stringify([{ type: 'tool-result', toolCallId, toolName, output: { type: 'json', value: { status: 'delivered', quote } } }]) }
    return { toolCallId, rows: [call, result] }
}

function userReply(decision: 'approved' | 'declined') {
    return { role: 'user', contentJson: JSON.stringify(serializeSpendDecision({ purpose: PURPOSE, decision })) }
}

// A decline written while the card still asked why.
const DECLINE_WITH_REASON = { role: 'user', contentJson: JSON.stringify(`Spend decision: **DECLINED** — ${PURPOSE}\nReason: Only 20 of them\n\nDo not call any paid data tool for this plan.`) }

const freeText = (text: string) => ({ role: 'user', contentJson: JSON.stringify([{ type: 'text', text }]) })

function ctx(paidDataAlwaysAllow = false, requestApproval = true) {
    return { agent: { id: 'prospector', config: { paidDataAlwaysAllow, tools: { requestApproval } } }, sessionId: 's1' } as any
}

beforeEach(() => {
    stored.rows = []
    stored.reads = 0
})

describe('findSpendApproval', () => {
    it('finds nothing in a session that never asked to spend', () => {
        const row = { role: 'assistant', contentJson: JSON.stringify([{ type: 'tool-call', toolCallId: 'a1', toolName: 'request_approval', input: { approvals: [{ action: 'Send it' }] } }]) }
        expect(findSpendApproval([row, userReply('approved')])).toBeNull()
    })

    it('finds nothing while the spend request is unanswered, or answered in free text', () => {
        const { rows } = spendRequest()
        expect(findSpendApproval(rows)).toBeNull()
        expect(findSpendApproval([...rows, { role: 'user', contentJson: JSON.stringify('sure, go ahead') }])).toBeNull()
    })

    it('finds nothing when the spend was declined, with or without a reason', () => {
        expect(findSpendApproval([...spendRequest().rows, userReply('declined')])).toBeNull()
        expect(findSpendApproval([...spendRequest().rows, DECLINE_WITH_REASON])).toBeNull()
    })

    it('returns the estimate the hub quoted for the approved request', () => {
        const { rows, toolCallId } = spendRequest(1_350_000)
        expect(findSpendApproval([...rows, userReply('approved')])).toEqual({ approvalId: toolCallId, estimateMicros: 1_350_000 })
    })

    it('reads the quote a CLI provider stores in the assistant turn, next to the call', () => {
        const { rows, toolCallId } = spendRequest(45_000)
        const turn = { role: 'assistant', contentJson: JSON.stringify([...JSON.parse(rows[0].contentJson), ...JSON.parse(rows[1].contentJson)]) }
        expect(findSpendApproval([turn, userReply('approved')])).toEqual({ approvalId: toolCallId, estimateMicros: 45_000 })
    })

    it('finds nothing when the request has no quote to hold the spend to', () => {
        const { rows } = spendRequest()
        expect(findSpendApproval([rows[0], userReply('approved')])).toBeNull()
    })

    it('closes the approval once the user writes again: a new task asks for its own card', () => {
        expect(findSpendApproval([...spendRequest().rows, userReply('approved'), freeText('now find 100 more in Lyon')])).toBeNull()
    })

    it('keeps the approval across the cards the run raises, a question answered or dismissed', () => {
        const { rows, toolCallId } = spendRequest(1_350_000)
        const answered = { role: 'user', contentJson: JSON.stringify(serializeAnswers([{ question: 'Which city?', answers: ['Lyon'] }])) }
        const dismissed = { role: 'user', contentJson: JSON.stringify(HITL_CANCELLED.question) }
        expect(findSpendApproval([...rows, userReply('approved'), answered, dismissed])).toEqual({ approvalId: toolCallId, estimateMicros: 1_350_000 })
    })

    it('lets a newer declined request close an older approved one', () => {
        const rows = [...spendRequest().rows, userReply('approved'), ...spendRequest().rows, userReply('declined')]
        expect(findSpendApproval(rows)).toBeNull()
    })

    it('reads a quote stored before the catalog, its lines naming a tool', () => {
        const { rows, toolCallId } = spendRequest(1_350_000, 'request_spend', { tool: 'leads_email_find' })
        expect(findSpendApproval([...rows, userReply('approved')])).toEqual({ approvalId: toolCallId, estimateMicros: 1_350_000 })
    })

    it('reads a tool call the CLI bridge prefixed', () => {
        const { rows, toolCallId } = spendRequest(2_000_000, 'mcp__rerun__request_spend')
        expect(findSpendApproval([...rows, userReply('approved')])?.approvalId).toBe(toolCallId)
    })
})

describe('checkSpendConsent', () => {
    it('refuses without an approval and says how to get one', async () => {
        const consent = await checkSpendConsent(ctx())
        expect(consent.granted).toBe(false)
        expect(!consent.granted && consent.reason).toContain('request_spend')
    })

    it('tells a coworker without approvals which setting unlocks paid data instead of naming a tool it lacks', async () => {
        const consent = await checkSpendConsent(ctx(false, false))
        expect(consent.granted).toBe(false)
        expect(!consent.granted && consent.reason).not.toContain('request_spend')
        expect(!consent.granted && consent.reason).toContain('Request approval')
    })

    it('grants an approved spend until it runs past its estimate, then asks again', async () => {
        const { rows, toolCallId } = spendRequest()
        stored.rows = [...rows, userReply('approved')]

        expect(await checkSpendConsent(ctx())).toEqual({ granted: true, approvalId: toolCallId })

        recordSpend(toolCallId, 2_000_000 * SPEND_OVERRUN_FACTOR)
        const consent = await checkSpendConsent(ctx())
        expect(consent.granted).toBe(false)
        expect(!consent.granted && consent.reason).toContain('300 credits went on it already')
    })

    it('opens a fresh count with a new approval', async () => {
        const first = spendRequest()
        recordSpend(first.toolCallId, 10_000_000)
        const second = spendRequest()
        stored.rows = [...first.rows, userReply('approved'), ...second.rows, userReply('approved')]

        expect(await checkSpendConsent(ctx())).toEqual({ granted: true, approvalId: second.toolCallId })
    })

    it('reads the history once per run, after the user turn reached the database', async () => {
        const { rows, toolCallId } = spendRequest()
        let storeTurn = () => {}
        const run = { ...ctx(), userTurnStored: new Promise<void>(resolve => (storeTurn = resolve)) }

        const first = checkSpendConsent(run)
        await Promise.resolve()
        expect(stored.reads).toBe(0)
        stored.rows = [...rows, userReply('approved')]
        storeTurn()

        expect(await first).toEqual({ granted: true, approvalId: toolCallId })
        expect(await checkSpendConsent(run)).toEqual({ granted: true, approvalId: toolCallId })
        expect(stored.reads).toBe(1)
        expect(await checkSpendConsent(ctx())).toEqual({ granted: true, approvalId: toolCallId })
        expect(stored.reads).toBe(2)
    })

    it('grants everything to a coworker the user allowed to spend without asking', async () => {
        expect(await checkSpendConsent(ctx(true))).toEqual({ granted: true, approvalId: null })
    })
})
