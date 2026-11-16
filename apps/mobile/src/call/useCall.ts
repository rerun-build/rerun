import { getLocales } from 'expo-localization'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { clientHeader, hubHeaders } from '@/api/client'
import { runningModel } from '@/api/models'
import { useAuth } from '@/auth/AuthProvider'
import { coworkerEndpoints } from '@/chat/endpoints'
import { useCoworkerChat } from '@/chat/useCoworkerChat'
import { environment } from '@/config/environment'
import { readCoworkerScreen } from '@/data/local-cache'

import { CallSession } from './call-session'

const ENGLISH = 'en-US'
const FRENCH = 'fr-FR'

function phoneLanguage(): string {
    return getLocales()[0]?.languageTag ?? ENGLISH
}

// The two languages the call switches between: the phone's own, and English (French on an English phone).
export function callLanguages(): [string, string] {
    const own = phoneLanguage()
    return [own, own.toLowerCase().startsWith('en') ? FRENCH : ENGLISH]
}

// A call with a coworker, in a conversation of its own that the first thing said opens.
export function useCall(agentId: string) {
    const { me, session: signedIn } = useAuth()
    const [endpoints] = useState(() => coworkerEndpoints(agentId))
    const [session] = useState(() => new CallSession(phoneLanguage()))
    const [kept] = useState(() => (me ? readCoworkerScreen(me.workspace.id, agentId) : null))
    const model = runningModel(kept?.models ?? null)?.label ?? 'unknown model'
    const chat = useCoworkerChat({ endpoints, initialSessionId: null, onRefused: () => session.refused() })
    const chatRef = useRef(chat)
    const modelRef = useRef(model)
    const caller = signedIn && me ? { accessToken: signedIn.access_token, workspaceId: me.workspace.id } : null
    const callerRef = useRef(caller)
    useEffect(() => {
        chatRef.current = chat
        modelRef.current = model
        callerRef.current = caller
    })

    useEffect(() => {
        session.start({ send: text => void chatRef.current.send(text), stop: () => void chatRef.current.stop(), model: () => modelRef.current, runId: () => chatRef.current.activeRunId(), speech: (text, voice, lang) => (callerRef.current ? { url: `${environment.apiUrl}/api/voice/speak?voice=${voice}&lang=${lang.slice(0, 2).toLowerCase()}&text=${encodeURIComponent(text)}`, headers: hubHeaders(clientHeader, callerRef.current) } : null) }).catch(() => {})
        return () => session.dispose()
    }, [session])

    useEffect(() => {
        session.onStream(chat.messages, chat.busy, chat.error)
    }, [session, chat.messages, chat.busy, chat.error])

    const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
    return { state, session, name: kept?.view?.agent?.name ?? '', model }
}
