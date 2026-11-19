import { pendingApprovals, pendingQuestions, pendingSpend, serializeAnswers, serializeApprovalDecisions, serializeSpendDecision, type ConversationReply, type PendingHitl } from '@rerun/contracts'

// The message an answer from outside the chat sends, worded the way the card in the chat would have
// sent it: the coworker reads one protocol, whichever surface answered.
export function replyTextOf(reply: ConversationReply, pending: Pick<PendingHitl, 'kind' | 'input'> | null): string | null {
    if (reply.action === 'reply') {
        const questions = pending?.kind === 'question' ? pendingQuestions(pending.input) : []
        if (questions.length === 1) return serializeAnswers([{ question: questions[0].question, answers: [reply.text] }])
        return reply.text
    }

    const decision = reply.action === 'approve' ? 'approved' : 'declined'
    if (pending?.kind === 'approval') return serializeApprovalDecisions(pendingApprovals(pending.input).map(item => ({ ...item, decision })))
    if (pending?.kind === 'spend') return serializeSpendDecision({ purpose: pendingSpend(pending.input).purpose, decision })
    return null
}
