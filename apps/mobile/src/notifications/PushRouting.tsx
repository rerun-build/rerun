import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import * as Notifications from 'expo-notifications'
import { router, type Href } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '@/auth/AuthProvider'

import { answersInPlace } from './categories'
import { pushDataOf } from './push'
import { forgetShortcut, usePendingShortcut } from './shortcut-link'

function hrefOf(agentId: string, conversationId: string | null): Href {
    if (agentId === FOREMAN_AGENT_ID) return { pathname: '/chat/[id]', params: { id: conversationId ?? 'last' } }
    return { pathname: '/chat/[id]', params: { id: conversationId ?? 'new', to: agentId } }
}

type Target = { id: string; workspaceId: number | null; href: Href }

// The phone moves to the target's workspace first; its conversation is handed to `OpenPushTarget` only
// once that workspace is the active one, as the hub answers for no other. A target that names no
// workspace opens where the phone is. Handled: opened, or given up on, as a switch the hub refused must
// not open it later, when the person moves to that workspace on their own.
function useTargetInItsWorkspace(target: Target | null, onHandled: (id: string) => void): { href: Href | null; opened: () => void } {
    const { me, switchWorkspace } = useAuth()
    const activeWorkspaceId = me?.workspace.id ?? null
    const switchedFor = useRef<string | null>(null)

    const id = target?.id ?? null
    const targetWorkspaceId = target?.workspaceId ?? null
    const pending = target !== null && activeWorkspaceId !== null
    const elsewhere = pending && targetWorkspaceId !== null && targetWorkspaceId !== activeWorkspaceId ? targetWorkspaceId : null

    useEffect(() => {
        if (elsewhere === null || id === null || switchedFor.current === id) return
        switchedFor.current = id
        switchWorkspace(elsewhere).catch(error => {
            console.warn('[push] switching to the workspace of a push or a shortcut failed', error)
            onHandled(id)
        })
    }, [elsewhere, id, switchWorkspace, onHandled])

    const opened = useCallback(() => {
        if (id !== null) onHandled(id)
    }, [id, onHandled])
    return { href: pending && elsewhere === null ? target.href : null, opened }
}

// A tap on a push, whether the app was running or launched by it, read whatever screen is up: a
// workspace with no plan has no Stack to open a conversation in, yet its pushes from another workspace
// still have to land.
export function usePushTarget() {
    const last = Notifications.useLastNotificationResponse()
    // Approve, Deny and a reply typed under the push are answered where they are: nothing opens.
    const response = last && !answersInPlace(last) ? last : null
    const [handledId, setHandledId] = useState<string | null>(null)

    const identifier = response?.notification.request.identifier ?? null
    const data = response ? pushDataOf(response.notification) : null
    const agentId = data?.agentId ?? null
    const conversationId = data?.conversationId ?? null
    const workspaceId = data?.workspaceId ?? null
    const target = useMemo(
        () => (identifier !== null && identifier !== handledId && agentId !== null ? { id: identifier, workspaceId, href: hrefOf(agentId, conversationId) } : null),
        [identifier, handledId, agentId, workspaceId, conversationId]
    )
    return useTargetInItsWorkspace(target, setHandledId)
}

// A tap on a coworker's shortcut, which lands as a push does.
export function useShortcutTarget() {
    return useTargetInItsWorkspace(usePendingShortcut(), forgetShortcut)
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
