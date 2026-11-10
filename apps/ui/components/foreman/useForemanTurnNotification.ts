'use client'

import type { ChatStatus, UIMessage } from 'ai'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'

import { showBrowserNotification } from '@/lib/notifications/browser'
import { useForemanStore } from '@/stores/foreman.store'

// A client tool answering flips the chat to `ready` for an instant before the turn resumes on its
// own: only a `ready` that holds is a Foreman waiting on the user.
const SETTLE_MS = 1500
const BODY_MAX_CHARS = 140

function lastAssistantText(messages: UIMessage[]): string | null {
    const message = messages.findLast(candidate => candidate.role === 'assistant')
    const text = message?.parts.findLast(part => part.type === 'text')?.text.trim()
    if (!text) return null
    return text.length > BODY_MAX_CHARS ? `${text.slice(0, BODY_MAX_CHARS - 1)}…` : text
}

// During the funnel, every turn that ends hands the user something to answer or look at: the plan,
// the trial card, the built team. The tab is often elsewhere by then, the build especially.
export function useForemanTurnNotification({ messages, status, guided }: { messages: UIMessage[]; status: ChatStatus; guided: boolean }) {
    const t = useTranslations('foreman.notification')
    const busy = status === 'submitted' || status === 'streaming'
    const waitingText = t('waiting')

    // Read when the turn starts: the turn that builds the team leaves the funnel before it ends.
    const turnGuided = useRef(false)
    const wasBusy = useRef(false)
    const latest = useRef({ messages, guided, waitingText })
    useEffect(() => {
        latest.current = { messages, guided, waitingText }
    })

    useEffect(() => {
        if (busy) {
            if (!wasBusy.current) turnGuided.current = latest.current.guided
            wasBusy.current = true
            return
        }
        if (!wasBusy.current) return
        wasBusy.current = false
        if (status !== 'ready' || !turnGuided.current) return

        const timer = setTimeout(() => {
            showBrowserNotification({
                title: 'Foreman',
                body: lastAssistantText(latest.current.messages) ?? latest.current.waitingText,
                tag: 'foreman',
                onClick: () => useForemanStore.getState().openForFunnel(),
            })
        }, SETTLE_MS)
        return () => clearTimeout(timer)
    }, [busy, status])
}
