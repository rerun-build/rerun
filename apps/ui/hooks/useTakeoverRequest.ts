import { useErrorText } from '@/hooks/useErrorText'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { finishTakeoverAction } from '@/app/api/_actions/desktop.actions'
import type { TakeoverRequestState } from '@/components/chat/TakeoverAsk'
import { serializeTakeoverResult, type TakeoverRequest } from '@/lib/chat-hitl'
import { useDesktopStore } from '@/stores/desktop.store'
import { siteOf } from '@rerun/contracts'

export type TakeoverAskInput = { callId: string; request: TakeoverRequest }

// The browser takeover a run waits on: opening it in the desktop dialog, handing it back, or leaving
// it to the coworker. `onDone` gets the chat message that resumes the run, once.
export function useTakeoverRequest(agentId: string, ask: TakeoverAskInput | null, onDone: (summary: string) => void, onSkip: () => void): TakeoverRequestState | undefined {
    const openTakeover = useDesktopStore(s => s.openTakeover)
    const handBack = useDesktopStore(s => s.handBack)
    const errorText = useErrorText()
    const callId = ask?.callId ?? null
    const handedBack = useDesktopStore(s => (callId ? s.handedBack[callId] : undefined))
    const [openedCallId, setOpenedCallId] = useState<string | null>(null)
    const [finishing, setFinishing] = useState(false)
    // Answering the agent twice starts two runs on the same conversation.
    const answeredRef = useRef<string | null>(null)

    useEffect(() => {
        if (!callId || !handedBack || answeredRef.current === callId) return
        answeredRef.current = callId
        onDone(serializeTakeoverResult(handedBack))
    }, [callId, handedBack, onDone])

    if (!ask) return undefined
    const opened = openedCallId === ask.callId
    const locked = finishing || !!handedBack

    const open = () => {
        if (locked) return
        setOpenedCallId(ask.callId)
        openTakeover({ agentId, callId: ask.callId, url: ask.request.url, reason: ask.request.reason })
    }

    const finish = async () => {
        if (locked) return
        setFinishing(true)
        const result = await finishTakeoverAction(agentId, { keepOpen: true })
        setFinishing(false)
        if (!result.ok) return void toast.error(errorText(result))
        handBack(ask.callId, { url: result.url, open: result.open })
    }

    const skip = () => {
        if (locked || answeredRef.current === ask.callId) return
        answeredRef.current = ask.callId
        if (opened) {
            void finishTakeoverAction(agentId)
            const { takeover, close } = useDesktopStore.getState()
            if (takeover?.callId === ask.callId) close()
        }
        onSkip()
    }

    return { reason: ask.request.reason, site: siteOf(ask.request.url), opened, locked, finishing, onOpen: open, onSkip: skip, onDone: () => void finish() }
}
