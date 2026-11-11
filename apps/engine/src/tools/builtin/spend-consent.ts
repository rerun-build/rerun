import { formatCreditsLabel, parseHitlReply, parseSpendDecision, readSpendQuote } from '@rerun/contracts'
import { extractText, listMessages } from '../../db/repos/messages.js'
import { canonicalHitlName } from './hitl.js'
import type { RunContext } from '../../runtime/context.js'

// How far past its estimate an approval stretches before the user is asked again. Not a cap on the
// credit: a real bill lands on either side of a rough estimate, and asking again over a few cents
// would only teach the user to stop reading the card.
export const SPEND_OVERRUN_FACTOR = 1.5

export type SpendApproval = { approvalId: string; estimateMicros: number }

export type SpendConsent = { granted: true; approvalId: string | null } | { granted: false; reason: string }

type StoredMessage = { role: string; contentJson: string }

// Spend counted against each approval while this engine runs. Messages only reach the database when
// a run settles, so the history cannot tell what a run in flight has already spent. A restart
// forgets the count, which at worst lets the run in flight go past its estimate once more: an
// approval closes with the user's next free message, so an old one never reopens. The hub's ledger
// keeps the real bill either way.
const spentByApproval = new Map<string, number>()

export function recordSpend(approvalId: string | null, micros: number): void {
    if (!approvalId || micros <= 0) return
    spentByApproval.set(approvalId, (spentByApproval.get(approvalId) ?? 0) + micros)
}

export function spentAgainst(approvalId: string): number {
    return spentByApproval.get(approvalId) ?? 0
}

function parseContent(json: string): unknown {
    try {
        return JSON.parse(json)
    } catch {
        return null
    }
}

type ContentPart = { type?: string; toolCallId?: string; toolName?: string; output?: { type?: string; value?: unknown } }

function spendRequestIn(content: unknown): string | null {
    if (!Array.isArray(content)) return null
    const call = (content as ContentPart[]).findLast(part => part?.type === 'tool-call' && part.toolCallId && canonicalHitlName(part.toolName) === 'request_spend')
    return call?.toolCallId ?? null
}

function quotedMicros(messages: StoredMessage[], toolCallId: string): number {
    for (const message of messages) {
        const content = parseContent(message.contentJson)
        if (!Array.isArray(content)) continue
        const result = (content as ContentPart[]).find(part => part?.type === 'tool-result' && part.toolCallId === toolCallId)
        if (result) return result.output?.type === 'json' ? (readSpendQuote(result.output.value)?.totalMicros ?? 0) : 0
    }
    return 0
}

const isHitlReply = (message: StoredMessage) => parseHitlReply(extractText(parseContent(message.contentJson))) !== null

// The latest request_spend of the session, and whether the user approved it. Only the latest counts:
// a newer request the user declined or has not answered yet closes whatever an older one opened.
// An approval covers the run it starts, through the cards that run may raise (a question, an
// approval): the next free message of the user is a new task, which asks for its own card.
export function findSpendApproval(messages: StoredMessage[]): SpendApproval | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role !== 'assistant') continue
        const toolCallId = spendRequestIn(parseContent(messages[i].contentJson))
        if (!toolCallId) continue

        const [reply, ...afterReply] = messages.slice(i + 1).filter(message => message.role === 'user')
        const decision = reply ? parseSpendDecision(extractText(parseContent(reply.contentJson))) : null
        if (decision?.decision !== 'approved') return null
        if (afterReply.some(message => !isHitlReply(message))) return null

        // A CLI provider runs the tool itself and stores the result in the assistant turn, next to the call.
        const estimateMicros = quotedMicros(messages.slice(i), toolCallId)
        return estimateMicros > 0 ? { approvalId: toolCallId, estimateMicros } : null
    }
    return null
}

const NO_APPROVAL =
    'Not run, nothing was billed: this tool spends the workspace Rerun credit and the user has not approved it. Call request_spend with what the user gets and every paid call you plan for this task, and end your turn. Call the tool again once the user approved. That card is the normal path, not a detour: do not fall back to web_search for this data.'

const NO_ONE_TO_APPROVE =
    'Not run, nothing was billed: this tool spends the workspace Rerun credit and nobody here can approve it. Tell the user to switch on Request approval for you, or to switch on Spend without asking.'

// Read once per run: messages only reach the database when a run settles, so what the history says
// cannot change while this run makes its paid calls. The user's reply is still on its way to the
// database when the run starts, hence the wait before the first read.
const approvalByRun = new WeakMap<RunContext, Promise<SpendApproval | null>>()

function loadApproval(ctx: RunContext): Promise<SpendApproval | null> {
    let approval = approvalByRun.get(ctx)
    if (!approval) {
        approval = Promise.resolve(ctx.userTurnStored)
            .then(() => listMessages(ctx.agent.id, ctx.sessionId))
            .then(findSpendApproval)
        approvalByRun.set(ctx, approval)
    }
    return approval
}

export async function checkSpendConsent(ctx: RunContext): Promise<SpendConsent> {
    if (ctx.agent.config.paidDataAlwaysAllow) return { granted: true, approvalId: null }

    const approval = await loadApproval(ctx)
    if (!approval) return { granted: false, reason: ctx.agent.config.tools.requestApproval ? NO_APPROVAL : NO_ONE_TO_APPROVE }

    const spent = spentAgainst(approval.approvalId)
    if (spent >= approval.estimateMicros * SPEND_OVERRUN_FACTOR) {
        return {
            granted: false,
            reason: `Not run, nothing was billed: the user approved about ${formatCreditsLabel(approval.estimateMicros)} and ${formatCreditsLabel(spent)} went on it already. Tell the user what the spend got so far, and ask again with request_spend for what is left, with soFar saying what the spend got, before going on.`,
        }
    }
    return { granted: true, approvalId: approval.approvalId }
}
