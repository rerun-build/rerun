import { MESSAGE_FEEDBACK_CATEGORIES, type MessageFeedbackCategory, type MessageFeedbackRating, type MessageFeedbackScope } from '@rerun/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { useTranslations } from 'use-intl'

import { clearMessageFeedback, fetchMessageFeedback, rateMessage, updateMessageFeedback } from '@/api/chat'
import { useAuth } from '@/auth/AuthProvider'
import { promptText, showActionSheet } from '@/components/ui/system-dialogs'

// The row id is a promise: the vote shows on the tap while the hub is still copying the transcript
// off the engine, and both the details and an undo wait for that row.
type Vote = { rating: MessageFeedbackRating; feedbackId: Promise<string | null> }
type SessionVotes = { sessionId: string | null; votes: ReadonlyMap<string, Vote> }

type FeedbackTranslator = ReturnType<typeof useTranslations<'mobileChat.feedback'>>

const NO_VOTES: ReadonlyMap<string, Vote> = new Map()

function askCategory(t: FeedbackTranslator): Promise<MessageFeedbackCategory | null | undefined> {
    const options = [...MESSAGE_FEEDBACK_CATEGORIES.map(category => t(`categories.${category.value}`)), t('skip'), t('cancel')]
    return new Promise(resolve =>
        showActionSheet({ title: t('negativeTitle'), message: t('categoryLabel'), options, cancelButtonIndex: options.length - 1 }, index => {
            if (index === options.length - 1) resolve(undefined)
            else resolve(MESSAGE_FEEDBACK_CATEGORIES[index]?.value ?? null)
        })
    )
}

function askDetails(rating: MessageFeedbackRating, t: FeedbackTranslator): Promise<string | undefined> {
    return new Promise(resolve =>
        promptText({
            title: rating === 'down' ? t('negativePlaceholder') : t('positivePlaceholder'),
            message: t('disclaimer'),
            cancelLabel: t('cancel'),
            submitLabel: t('submit'),
            preferred: true,
            onCancel: () => resolve(undefined),
            onSubmit: resolve,
        })
    )
}

// The web's useMessageFeedback: a thumb per answer, a second tap on the same one takes the vote back,
// and the details are asked once the vote has landed (a sheet dismissed still counts).
export function useMessageFeedback(sessionId: string | null, scope: MessageFeedbackScope) {
    const { session, me } = useAuth()
    const t = useTranslations('mobileChat.feedback')
    const caller = useMemo(() => (session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null), [session, me])
    const [sessionVotes, setSessionVotes] = useState<SessionVotes>({ sessionId: null, votes: NO_VOTES })
    const votes = sessionVotes.sessionId === sessionId ? sessionVotes.votes : NO_VOTES
    const votesRef = useRef(votes)
    useEffect(() => {
        votesRef.current = votes
    })

    const updateVotes = useCallback(
        (update: (current: ReadonlyMap<string, Vote>) => ReadonlyMap<string, Vote>) => setSessionVotes(current => ({ sessionId, votes: update(current.sessionId === sessionId ? current.votes : NO_VOTES) })),
        [sessionId]
    )

    useEffect(() => {
        if (!sessionId || !caller) return
        let cancelled = false
        fetchMessageFeedback(caller, sessionId, scope)
            .then(rows => {
                if (cancelled) return
                // A tap that beat this read is newer than anything it returns.
                updateVotes(current => new Map([...rows.map(row => [row.messageId, { rating: row.rating, feedbackId: Promise.resolve<string | null>(row.id) }] as const), ...current]))
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [sessionId, scope, caller, updateVotes])

    const setVote = useCallback(
        (messageId: string, vote: Vote | undefined) =>
            updateVotes(current => {
                const next = new Map(current)
                if (vote) next.set(messageId, vote)
                else next.delete(messageId)
                return next
            }),
        [updateVotes]
    )

    const rate = useCallback(
        async (messageId: string, rating: MessageFeedbackRating, messageText: string) => {
            if (!sessionId || !caller) return
            const previous = votesRef.current.get(messageId)

            if (previous?.rating === rating) {
                setVote(messageId, undefined)
                try {
                    const id = await previous.feedbackId
                    if (id) await clearMessageFeedback(caller, id)
                } catch {
                    setVote(messageId, previous)
                    Alert.alert(t('removeFailed'))
                }
                return
            }

            const feedbackId = rateMessage(caller, sessionId, { scope, messageId, rating, messageText }).catch(() => null)
            setVote(messageId, { rating, feedbackId })
            const category = rating === 'down' ? await askCategory(t) : null
            const details = category === undefined ? undefined : await askDetails(rating, t)
            const id = await feedbackId
            if (!id) {
                setVote(messageId, previous)
                Alert.alert(t('saveFailed'))
                return
            }
            if (details === undefined || (!category && !details.trim())) return
            await updateMessageFeedback(caller, id, { category: category ?? null, details }).catch(() => Alert.alert(t('saveFailed')))
        },
        [sessionId, scope, caller, setVote, t]
    )

    const ratingOf = useCallback((messageId: string) => votes.get(messageId)?.rating ?? null, [votes])

    return { ratingOf, rate }
}

export type MessageFeedback = ReturnType<typeof useMessageFeedback>
