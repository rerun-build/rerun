import { HITL_CANCELLED, pendingTakeover, serializeTakeoverResult, type PendingHitl } from '@rerun/contracts'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { Alert } from 'react-native'

import { finishTakeover } from '@/api/desktop'
import { useAuth } from '@/auth/AuthProvider'
import { awaitHandBack, handBack } from '@/desktop/hand-back'
import { translatorFor } from '@/i18n/translator'
import { setPendingDesktopOpen } from '@/desktop/pending-open'
import { hostOf } from '@/lib/url'

export type TakeoverRequestState = {
    reason: string
    site: string | null
    opened: boolean
    // The browser is being handed back, or already was: nothing is left to press.
    locked: boolean
    finishing: boolean
    onOpen: () => void
    onSkip: () => void
    onDone: () => void
}

// The web's `useTakeoverRequest`: the browser takeover a run waits on, opened full screen, handed
// back from there or from the thread, or left to the coworker. `onAnswer` gets the message that
// resumes the run, once: answering twice starts two runs on the same conversation.
export function useTakeoverRequest(agentId: string, coworkerName: string, pending: PendingHitl | null, onAnswer: (text: string) => void): TakeoverRequestState | undefined {
    const { session, me } = useAuth()
    const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
    const [openedCallId, setOpenedCallId] = useState<string | null>(null)
    const [answeredCallId, setAnsweredCallId] = useState<string | null>(null)
    const [finishing, setFinishing] = useState(false)
    const answeredRef = useRef<string | null>(null)

    if (!pending) return undefined
    const callId = pending.toolCallId
    const { url, reason } = pendingTakeover(pending.input)
    const opened = openedCallId === callId
    const locked = finishing || answeredCallId === callId

    const answer = (text: string) => {
        if (answeredRef.current === callId) return
        answeredRef.current = callId
        setAnsweredCallId(callId)
        onAnswer(text)
    }

    // Opened again, the browser stays on the page the person left it on.
    const open = () => {
        if (locked) return
        awaitHandBack(callId).then(left => answer(serializeTakeoverResult(left)))
        setPendingDesktopOpen({ agentId, name: coworkerName, call: callId, url: opened ? undefined : url })
        setOpenedCallId(callId)
        router.push({ pathname: '/desktop', params: { agent: agentId } })
    }

    const done = async () => {
        if (locked || !caller) return
        setFinishing(true)
        try {
            const left = await finishTakeover(caller, agentId, { keepOpen: true })
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            handBack(callId, left)
            answer(serializeTakeoverResult(left))
        } catch (err) {
            Alert.alert(translatorFor('mobileChat')('screen.handBackFailed'), err instanceof Error ? err.message : translatorFor('mobileCommon')('errors.tryAgainShortly'))
        } finally {
            setFinishing(false)
        }
    }

    const skip = () => {
        if (locked) return
        if (opened && caller) finishTakeover(caller, agentId).catch(() => {})
        answer(HITL_CANCELLED.takeover)
    }

    return { reason, site: hostOf(url), opened, locked, finishing, onOpen: open, onSkip: skip, onDone: () => void done() }
}
