'use client'

import type { UIMessage } from 'ai'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'

import { useToolDisplay } from '@/hooks/useToolDisplay'
import { foremanDockFeed } from '@/lib/foreman/dock-feed'
import type { PendingWidget } from '@/lib/foreman/pending-widget'
import { useForemanStore } from '@/stores/foreman.store'

type Options = { messages: UIMessage[]; busy: boolean; open: boolean; pending: PendingWidget | null; failed: boolean }

export function useForemanDockFeed({ messages, busy, open, pending, failed }: Options) {
    const t = useTranslations('chat.activity')
    const tSubRuns = useTranslations('subRuns')
    const toolDisplay = useToolDisplay()
    const feed = foremanDockFeed({ messages, busy, pending, failed, copy: { t, subRuns: tSubRuns, toolLabel: toolName => toolDisplay(toolName).label } })
    const { label, pending: question } = feed
    const replyId = feed.reply?.id ?? null
    const replyText = feed.reply?.text ?? null

    const ranWhileClosed = useRef(false)
    useEffect(() => {
        if (open) ranWhileClosed.current = false
        else if (busy) ranWhileClosed.current = true
        const announced = ranWhileClosed.current
        useForemanStore.getState().setDock({
            busy,
            label,
            pending: question,
            reply: announced && replyId !== null && replyText !== null ? { id: replyId, text: replyText } : null,
            failed: announced && failed,
        })
    }, [open, busy, label, question, replyId, replyText, failed])
}
