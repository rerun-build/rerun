import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import * as Notifications from 'expo-notifications'
import { router, type Href } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '@/auth/AuthProvider'

import { pushDataOf } from './push'

function hrefOf(agentId: string, conversationId: string | null): Href {
    if (agentId === FOREMAN_AGENT_ID) return { pathname: '/chat/[id]', params: { id: conversationId ?? 'last' } }
    return { pathname: '/chat/[id]', params: { id: conversationId ?? 'new', to: agentId } }
}

// A tap on a push, whether the app was running or launched by it, read whatever screen is up: a
// workspace with no plan has no Stack to open a conversation in, yet its pushes from another workspace
// still have to land. The phone moves to the push's workspace first; its conversation is handed to
// `OpenPushTarget` only once that workspace is the active one, as the hub answers for no other. A push
// sent before pushes named their workspace opens where the phone is.
export function usePushTarget(): { href: Href | null; opened: () => void } {
    const response = Notifications.useLastNotificationResponse()
    const { me, switchWorkspace } = useAuth()
    const activeWorkspaceId = me?.workspace.id ?? null
    // The push opened, or given up on: a switch the hub refused must not open it later, when the person
    // moves to that workspace on their own.
    const [handledId, setHandledId] = useState<string | null>(null)
    const switchedFor = useRef<string | null>(null)

    const identifier = response?.notification.request.identifier ?? null
    const data = response ? pushDataOf(response.notification) : null
    const agentId = data?.agentId ?? null
    const conversationId = data?.conversationId ?? null
    const pending = identifier !== null && identifier !== handledId && agentId !== null && activeWorkspaceId !== null
    const pushWorkspaceId = data?.workspaceId ?? null
    const elsewhere = pending && pushWorkspaceId !== null && pushWorkspaceId !== activeWorkspaceId ? pushWorkspaceId : null

    useEffect(() => {
        if (elsewhere === null || identifier === null || switchedFor.current === identifier) return
        switchedFor.current = identifier
        switchWorkspace(elsewhere).catch(error => {
            console.warn('[push] switching to the workspace of a push failed', error)
            setHandledId(identifier)
        })
    }, [elsewhere, identifier, switchWorkspace])

    const ready = pending && elsewhere === null
    const href = useMemo(() => (ready && agentId ? hrefOf(agentId, conversationId) : null), [ready, agentId, conversationId])
    const opened = useCallback(() => setHandledId(identifier), [identifier])
    return { href, opened }
}

// Mounted with the Stack, which a conversation needs to be pushed onto.
export function OpenPushTarget({ href, onOpened }: { href: Href | null; onOpened: () => void }) {
    useEffect(() => {
        if (!href) return
        const timer = setTimeout(() => {
            router.push(href)
            onOpened()
        }, 0)
        return () => clearTimeout(timer)
    }, [href, onOpened])
    return null
}
