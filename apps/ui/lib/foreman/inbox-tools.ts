import 'server-only'

import type { Actor, UserActor } from '@/app/api/_auth/access'
import { getSessionEngineContext, decideCoworkerSkillProposal } from '@/app/api/_services/chat.service'
import { listPendingCards, readPendingRequest, type PendingCard } from '@/app/api/_services/conversation.service'
import { messageAuthorOf } from '@/app/api/_services/me.service'
import { replyAs } from '@/app/api/_services/reply.service'
import { ApiError } from '@/lib/api-error'
import { asString, requireString } from '@/lib/mcp/args'
import { authUserOf, NO_MEMBER_BEHIND_KEY } from '@/lib/mcp/member'
import { pendingApprovals, pendingQuestions, pendingSpend, serializeAnswers, type ConversationReply, type HitlKind, type MessageAuthor } from '@rerun/contracts'

// What only the person can do, and the line the Chief of Staff tells them instead of answering.
const LEFT_TO_THE_USER: Partial<Record<HitlKind, string>> = {
    secret: 'A credential is typed by the user into the card, never by you: tell them which one the coworker needs and to open its conversation.',
    service: 'Connecting an app signs the user in to it: tell them which app and to connect it from the card.',
    mcp: 'Signing in to a server is the user\'s own login: tell them which one and to sign in from the card.',
    takeover: 'The coworker hands its browser to the user: only they can take it, from the card.',
    computer: 'Access to a linked computer is the user\'s own yes, given on the card.',
    feature: 'What goes to the Rerun team in their name is the user\'s to send: tell them what the coworker drafted and to send, edit or skip it from the card.',
}

const CONTEXT_MAX = 600

const clip = (text: string | null) => (text && text.length > CONTEXT_MAX ? `${text.slice(0, CONTEXT_MAX)}…` : text)

type CardKind = HitlKind | 'skill_proposal' | 'unknown'

function kindOf(card: PendingCard): CardKind {
    if (card.peek.pending) return card.peek.pending.kind
    return card.peek.proposal ? 'skill_proposal' : 'unknown'
}

// One card as the Chief of Staff reads it: what the coworker asks, in its words, and how to answer.
function projectCard(card: PendingCard) {
    const { pending, proposal, ask, before } = card.peek
    const kind = kindOf(card)
    const input = pending?.input ?? {}
    const leftToUser = LEFT_TO_THE_USER[kind as HitlKind]
    return {
        sessionId: card.sessionId,
        coworker: card.agentName,
        agentId: card.agentId,
        conversation: card.title,
        waitingSince: card.updatedAt,
        kind,
        ...(pending && { toolCallId: pending.toolCallId }),
        ask: clip(ask) || null,
        earlier: clip(before),
        ...(kind === 'question' && { questions: pendingQuestions(input).map(item => ({ question: item.question, options: item.options.map(option => option.label), multiple: item.multiple })) }),
        ...(kind === 'approval' && { approvals: pendingApprovals(input) }),
        ...(kind === 'spend' && { spend: pendingSpend(input) }),
        ...(proposal && { proposal: { proposalId: proposal.id, title: proposal.title, summary: proposal.summary } }),
        ...(leftToUser ? { answeredBy: 'user', why: leftToUser } : kind === 'unknown' ? { answeredBy: 'user', why: 'Nothing on this conversation can be answered from here: tell the user to open it.' } : { answeredBy: 'answer_card' }),
    }
}

// Who answers a card in the member's name: the Chief of Staff, whose answer the conversation shows as
// relayed, or an outside assistant on the member's own API key, whose answer reads as theirs.
export type CardAnswerer = 'foreman' | 'api'

function personBehind(actor: Actor, answerer: CardAnswerer): UserActor {
    if (actor.kind === 'user') return actor
    if (answerer === 'api') throw new Error(NO_MEMBER_BEHIND_KEY)
    throw new Error('A card is answered in the name of the member you are talking to, and this turn has none behind it. Tell the user what waits on them instead.')
}

async function authorFor(actor: UserActor, answerer: CardAnswerer): Promise<MessageAuthor> {
    const authUser = await authUserOf(actor)
    const author = authUser ? await messageAuthorOf({ userId: actor.userId, authUser, organizationStaff: actor.organizationStaff, workspace: { id: actor.workspaceId } }) : { id: actor.userId }
    return answerer === 'foreman' ? { ...author, via: 'foreman' } : author
}

const SPEND_NEEDS_A_YES: Record<CardAnswerer, string> = {
    foreman: "Spending money needs the user's own yes: ask them with request_approval, naming the coworker and what it would pay for, then call again with userApproved: true once they approved.",
    api: "Spending money needs the user's own yes: ask them, naming the coworker and what it would pay for, then call again with userApproved: true once they approved.",
}

const stale = () => new Error('This card was answered or closed in the meantime. Read what still waits with list_pending_cards.')

type AnswerAction = 'reply' | 'approve' | 'decline'

function answerActionOf(value: unknown): AnswerAction {
    if (value === 'reply' || value === 'approve' || value === 'decline') return value
    throw new Error('action is "reply" for a question, "approve" or "decline" for an approval, a spend or a skill proposal.')
}

type GivenAnswer = { question: string; answer: string }

function givenAnswersOf(value: unknown): GivenAnswer[] {
    if (!Array.isArray(value)) return []
    return value.map(entry => {
        const { question, answer } = (entry ?? {}) as { question?: unknown; answer?: unknown }
        return { question: typeof question === 'string' ? question.trim() : '', answer: typeof answer === 'string' ? answer.trim() : '' }
    })
}

// The answer to a question card. A single question takes the bare text: replyTextOf words it the way
// the card would. Several take one answer each, and a question left without one is refused rather
// than sent as skipped in the member's name.
function questionReplyText(input: Record<string, unknown>, args: Record<string, unknown>): string {
    const questions = pendingQuestions(input)
    const given = givenAnswersOf(args.answers)
    if (questions.length <= 1) return requireString(asString(args.text)?.trim() || given[0]?.answer, 'text')
    if (given.length === 0) return requireString(asString(args.text)?.trim(), 'text')

    const asked = questions.map(item => item.question.trim())
    const answered = asked.map(question => given.find(entry => entry.question === question)?.answer ?? '')
    const unknown = given.filter(entry => !asked.includes(entry.question))
    if (answered.some(answer => !answer) || unknown.length > 0) {
        throw new Error(`Give one answer to each question of this card, the question copied exactly as list_pending_cards gave it: ${asked.map(question => JSON.stringify(question)).join(', ')}. Nothing was sent.`)
    }
    return serializeAnswers(questions.map((item, index) => ({ question: item.question, answers: [answered[index]] })))
}

async function answerCard(caller: Actor, args: Record<string, unknown>, answerer: CardAnswerer) {
    const sessionId = requireString(args.sessionId, 'sessionId')
    const action = answerActionOf(args.action)
    const actor = personBehind(caller, answerer)
    const author = await authorFor(actor, answerer)
    const peek = await readPendingRequest(sessionId, actor)

    const proposalId = asString(args.proposalId)
    if (proposalId) {
        if (action === 'reply') throw new Error('A skill proposal is decided with "approve" (remember it) or "decline".')
        if (peek.proposal?.id !== proposalId) throw stale()
        const target = await getSessionEngineContext(sessionId, actor)
        if (!target) throw stale()
        const proposal = await decideCoworkerSkillProposal(target, sessionId, proposalId, action === 'approve' ? 'accept' : 'dismiss', actor)
        return { sessionId, answered: 'skill_proposal', decision: action === 'approve' ? 'remembered' : 'declined', proposal: { title: proposal.title, status: proposal.status } }
    }

    const pending = peek.pending
    if (!pending) throw peek.proposal ? new Error('A skill proposal waits in this conversation: decide it with its proposalId from list_pending_cards.') : stale()
    const toolCallId = requireString(args.toolCallId, 'toolCallId')
    if (toolCallId !== pending.toolCallId) throw stale()

    const leftToUser = LEFT_TO_THE_USER[pending.kind]
    if (leftToUser) throw new Error(leftToUser)

    let reply: ConversationReply
    if (pending.kind === 'question') {
        if (action !== 'reply') throw new Error('A question is answered with action "reply" and the answer in text, or one per question in answers.')
        reply = { action: 'reply', toolCallId, text: questionReplyText(pending.input, args) }
    } else {
        if (action === 'reply') throw new Error(`This card is ${pending.kind === 'spend' ? 'a spend' : 'an approval'}: answer it with "approve" or "decline".`)
        if (pending.kind === 'spend' && action === 'approve' && args.userApproved !== true) {
            throw new Error(SPEND_NEEDS_A_YES[answerer])
        }
        reply = { action: action === 'approve' ? 'approve' : 'deny', toolCallId }
    }

    try {
        const { runId } = await replyAs(actor, author, sessionId, reply)
        return { sessionId, answered: pending.kind, ...(reply.action === 'reply' ? { answer: reply.text } : { decision: reply.action === 'approve' ? 'approved' : 'declined' }), runId, note: 'The coworker is working on it again. Tell the user what you answered, card by card.' }
    } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.code === 'requestAlreadyAnswered') throw stale()
        throw err
    }
}

// The cards the coworkers left waiting on the user, and the answers given them in the user's name:
// by the Chief of Staff (app/api/_services/foreman-hub.service.ts) or the account MCP server.
export async function dispatchInboxTool(actor: Actor, name: string, args: Record<string, unknown>, answerer: CardAnswerer = 'foreman'): Promise<unknown> {
    switch (name) {
        case 'list_pending_cards': {
            const cards = (await listPendingCards(actor)).map(projectCard)
            return { cards, ...(cards.length === 0 && { note: 'Nothing waits on the user.' }) }
        }
        case 'answer_card':
            return answerCard(actor, args, answerer)
        default:
            throw new Error(`Unknown tool: ${name}`)
    }
}
