'use client'

import { clearMessageFeedbackAction, fetchSessionFeedbackAction, rateMessageAction, updateMessageFeedbackAction, type FeedbackScope } from '@/app/api/_actions/message-feedback.actions'
import type { MessageFeedbackDetails } from '@/components/chat/MessageFeedbackDialog'
import type { MessageFeedbackRating } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

// The row id is a promise: the vote shows on the click, while the server is still copying the
// transcript off the engine, and both the dialog and an undo have to wait for that row.
type Vote = { rating: MessageFeedbackRating; feedbackId: Promise<string | null> }

// Kept once closed so the dialog does not change title while it animates out.
type FeedbackDialog = { open: boolean; rating: MessageFeedbackRating; feedbackId: Promise<string | null> }

type SessionVotes = { sessionId: string | null; votes: ReadonlyMap<string, Vote> }

const NO_VOTES: ReadonlyMap<string, Vote> = new Map()

export function useMessageFeedback(sessionId: string | null | undefined, scope: FeedbackScope = 'agent') {
    const t = useTranslations('chat.feedback')
    const key = sessionId ?? null
    // Tagged with the session they belong to, so switching conversations shows none of the last one's.
    const [sessionVotes, setSessionVotes] = useState<SessionVotes>({ sessionId: null, votes: NO_VOTES })
    const votes = sessionVotes.sessionId === key ? sessionVotes.votes : NO_VOTES
    const [dialog, setDialog] = useState<FeedbackDialog | null>(null)
    const votesRef = useRef(votes)
    useEffect(() => {
        votesRef.current = votes
    })

    const updateVotes = useCallback(
        (update: (current: ReadonlyMap<string, Vote>) => ReadonlyMap<string, Vote>) => setSessionVotes(current => ({ sessionId: key, votes: update(current.sessionId === key ? current.votes : NO_VOTES) })),
        [key],
    )

    useEffect(() => {
        if (!key) return
        let cancelled = false
        fetchSessionFeedbackAction(key, scope)
            .then(rows => {
                if (cancelled) return
                // A click that beat this read is newer than anything it returns.
                updateVotes(current => new Map([...rows.map(row => [row.messageId, { rating: row.rating, feedbackId: Promise.resolve<string | null>(row.id) }] as const), ...current]))
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [key, scope, updateVotes])

    const setVote = useCallback(
        (messageId: string, vote: Vote | undefined) =>
            updateVotes(current => {
                const next = new Map(current)
                if (vote) next.set(messageId, vote)
                else next.delete(messageId)
                return next
            }),
        [updateVotes],
    )

    const rate = useCallback(
        (messageId: string, rating: MessageFeedbackRating, messageText: string) => {
            if (!sessionId) return
            const previous = votesRef.current.get(messageId)

            if (previous?.rating === rating) {
                setVote(messageId, undefined)
                void previous.feedbackId
                    .then(id => (id ? clearMessageFeedbackAction(id) : { ok: true as const }))
                    .then(res => {
                        if (!res.ok) throw new Error(res.error)
                    })
                    .catch(() => {
                        setVote(messageId, previous)
                        toast.error(t('removeFailed'))
                    })
                return
            }

            const feedbackId = rateMessageAction({ sessionId, scope, messageId, rating, messageText })
                .then(res => (res.ok ? res.id : null))
                .catch(() => null)
            setVote(messageId, { rating, feedbackId })
            setDialog({ open: true, rating, feedbackId })
            void feedbackId.then(id => {
                if (id) return
                setVote(messageId, previous)
                setDialog(current => (current?.feedbackId === feedbackId ? { ...current, open: false } : current))
                toast.error(t('saveFailed'))
            })
        },
        [sessionId, scope, setVote, t],
    )

    const submitDetails = useCallback(
        async ({ category, details }: MessageFeedbackDetails): Promise<boolean> => {
            const id = await dialog?.feedbackId
            if (!id) return false
            const res = await updateMessageFeedbackAction({ id, category, details }).catch(() => null)
            if (!res?.ok) {
                toast.error(t('saveFailed'))
                return false
            }
            toast.success(t('thanks'))
            return true
        },
        [dialog, t],
    )

    const onDialogOpenChange = useCallback((open: boolean) => {
        if (!open) setDialog(current => (current ? { ...current, open: false } : current))
    }, [])

    return { votes, rate, dialogOpen: dialog?.open ?? false, dialogRating: dialog?.rating ?? 'up', submitDetails, onDialogOpenChange }
}
