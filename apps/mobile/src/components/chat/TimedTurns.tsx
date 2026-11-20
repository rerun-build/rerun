import { authorTurnsOf, splitTurnsAtBreaks, timeBreaksOf, type AuthorProfile } from '@rerun/contracts'
import type { UIMessage } from 'ai'
import { Fragment, useMemo, useState, type ReactNode } from 'react'

import { useMessageTimes } from '@/chat/useMessageTimes'

import { AuthoredGroup } from './AuthoredGroup'
import { ChatTimeSeparator } from './ChatTimeSeparator'
import type { MessageStamp } from './MessageTimeReveal'

type TimedTurnsProps = {
    messages: UIMessage[]
    // `undefined` leaves the turn unsigned, `null` holds the avatar's place while the profile loads.
    authorOf: (authorId: string) => AuthorProfile | null | undefined
    renderMessage: (message: UIMessage, index: number, stamp: MessageStamp) => ReactNode
    // Only the turns that open in [from, to), the whole thread laid out as if it were all there.
    from?: number
    to?: number
}

/**
 * The thread as the web's `AgentChat` lays it out: iMessage's day and time over each stretch of the
 * conversation, the messages one person sent signed once, and the time of the one bubble tapped.
 */
export function TimedTurns({ messages, authorOf, renderMessage, from = 0, to = Infinity }: TimedTurnsProps) {
    const times = useMessageTimes(messages)
    const breaks = useMemo(() => timeBreaksOf(times), [times])
    const turns = useMemo(() => splitTurnsAtBreaks(authorTurnsOf(messages), breaks), [messages, breaks])
    const [revealedId, setRevealedId] = useState<string | null>(null)

    return turns.map(turn => {
        const opening = turn.items[0].index
        if (opening < from || opening >= to) return null
        const views = turn.items.map(({ message, index }) => renderMessage(message, index, { createdAt: times[index], shown: revealedId === message.id, onToggle: () => setRevealedId(current => (current === message.id ? null : message.id)) }))
        const author = turn.authorId ? authorOf(turn.authorId) : undefined
        return (
            <Fragment key={turn.key}>
                {breaks.has(opening) && <ChatTimeSeparator createdAt={times[opening]} />}
                {author !== undefined ? <AuthoredGroup author={author} relayed={turn.relayed}>{views}</AuthoredGroup> : views}
            </Fragment>
        )
    })
}
