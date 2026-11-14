import { authorTurnsOf, splitTurnsAtBreaks, timeBreaksOf, type AuthorProfile } from '@rerun/contracts'
import type { UIMessage } from 'ai'
import { Fragment, useMemo, useState, type ReactNode } from 'react'

import { useMessageTimes } from '@/chat/useMessageTimes'

import { AuthoredGroup } from './AuthoredGroup'
import { ChatTimeSeparator } from './ChatTimeSeparator'
import type { MessageStamp } from './MessageTimeReveal'

type TimedTurnsProps = {
    messages: UIMessage[]
    authorOf: (authorId: string) => AuthorProfile | null | undefined
    renderMessage: (message: UIMessage, index: number, stamp: MessageStamp) => ReactNode
}

export function TimedTurns({ messages, authorOf, renderMessage }: TimedTurnsProps) {
    const times = useMessageTimes(messages)
    const breaks = useMemo(() => timeBreaksOf(times), [times])
    const turns = useMemo(() => splitTurnsAtBreaks(authorTurnsOf(messages), breaks), [messages, breaks])
    const [revealedId, setRevealedId] = useState<string | null>(null)

    return turns.map(turn => {
        const views = turn.items.map(({ message, index }) => renderMessage(message, index, { createdAt: times[index], shown: revealedId === message.id, onToggle: () => setRevealedId(current => (current === message.id ? null : message.id)) }))
        const author = turn.authorId ? authorOf(turn.authorId) : undefined
        const opening = turn.items[0].index
        return (
            <Fragment key={turn.key}>
                {breaks.has(opening) && <ChatTimeSeparator createdAt={times[opening]} />}
                {author !== undefined ? <AuthoredGroup author={author}>{views}</AuthoredGroup> : views}
            </Fragment>
        )
    })
}
