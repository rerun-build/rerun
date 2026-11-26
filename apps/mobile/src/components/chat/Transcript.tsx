import type { AuthorProfile, MessageFeedbackRating, PaidTurnSources } from '@rerun/contracts'
import type { UIMessage } from 'ai'
import { Fragment, memo, useMemo } from 'react'

import type { FileOwner } from '@/api/files'
import type { SkillProposals } from '@/chat/useSkillProposals'

import { publishCardsByMessage } from './cards/cards'
import { MessageView } from './MessageView'
import { StartedByBanner, type StartedBy } from './origins/StartedByBanner'
import type { ThreadItem } from './threads/general-threads'
import { ThreadBranch } from './threads/ThreadBranch'
import { TimedTurns } from './TimedTurns'

type TranscriptProps = {
    messages: UIMessage[]
    // The stretch drawn, [from, to) in `messages`: the whole thread is laid out, this part is drawn.
    from: number
    to: number
    busy: boolean
    // The coworker whose files and cards the messages point at; null for the Foreman.
    agentId: string | null
    coworkerName: string
    fileOwner: FileOwner | null
    hiddenCallId: string | null
    skillProposals?: SkillProposals
    onStopTask: (taskId: string) => void
    // Left out while a block waits on an answer.
    onRegenerate?: () => void
    ratingOf: (messageId: string) => MessageFeedbackRating | null
    onRate: (messageId: string, rating: MessageFeedbackRating, text: string) => void
    paidSourcesByTurn: Map<string, PaidTurnSources>
    authorOf: (authorId: string) => AuthorProfile | null | undefined
    startedBy: StartedBy | null
    // General only: the threads hung under the message each one was opened after.
    threadRows: { leading: ThreadItem[]; after: Map<number, ThreadItem[]> }
    onOpenThread: (sessionId: string) => void
}

// The messages of a conversation, drawn apart from what changes around them: typing in the composer,
// scrolling or a block coming up redraws none of them, and a streamed reply redraws its own message alone.
export const Transcript = memo(function Transcript({ messages, from, to, busy, agentId, coworkerName, fileOwner, hiddenCallId, skillProposals, onStopTask, onRegenerate, ratingOf, onRate, paidSourcesByTurn, authorOf, startedBy, threadRows, onOpenThread }: TranscriptProps) {
    const lastAssistant = messages.findLastIndex(message => message.role === 'assistant')
    // A run touches the turn it answers and the answer before it, whose buttons wait for it to end.
    const turnStart = messages.findLastIndex(message => message.role === 'user')
    const publishedCards = useMemo(() => publishCardsByMessage(messages), [messages])
    const branches = (rows: ThreadItem[] | undefined) => rows?.map(thread => <ThreadBranch key={thread.id} thread={thread} onOpen={() => onOpenThread(thread.id)} />)
    return (
        <>
            {from === 0 && startedBy && <StartedByBanner startedBy={startedBy} />}
            {from === 0 && branches(threadRows.leading)}
            <TimedTurns
                messages={messages}
                from={from}
                to={to}
                authorOf={authorOf}
                renderMessage={(message, index, stamp) => (
                    <Fragment key={message.id}>
                        <MessageView message={message} isLastAssistant={index === lastAssistant} running={busy && (index >= turnStart || index === lastAssistant)} settled={!busy || index < turnStart} agentId={agentId} fileOwner={fileOwner} coworkerName={coworkerName} hiddenCallId={hiddenCallId} skillProposals={skillProposals} onStopTask={onStopTask} onRegenerate={index === lastAssistant ? onRegenerate : undefined} rating={ratingOf(message.id)} onRate={onRate} stamp={stamp} paidSources={paidSourcesByTurn.get(message.id)} publishedCards={publishedCards.get(message.id)} />
                        {branches(threadRows.after.get(index))}
                    </Fragment>
                )}
            />
        </>
    )
})
