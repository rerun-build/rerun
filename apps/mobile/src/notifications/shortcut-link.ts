import { ROUTE_ID_PATTERN } from '@rerun/contracts'
import type { Href } from 'expo-router'
import { useSyncExternalStore } from 'react'

import { generalHref } from '@/components/chat/conversation-pages'

// A coworker's shortcut on the app's icon (Android), as push-portrait writes its link: the only links into
// a chat that name their workspace. The router opens a link where the phone is, so they wait here for the
// phone to be in that workspace.
export type ShortcutTarget = { id: string; workspaceId: number; href: Href }

const SHORTCUT_LINK = /^(?:rerun:\/)?\/chat\/(general|last)\?(.+)$/

function readLink(path: string): Omit<ShortcutTarget, 'id'> | null {
    const [, page, query] = SHORTCUT_LINK.exec(path) ?? []
    if (!page) return null
    const params = new URLSearchParams(query)
    const workspace = params.get('workspace')
    if (!workspace || !/^[1-9]\d*$/.test(workspace)) return null
    const workspaceId = Number(workspace)
    if (page === 'last') return { workspaceId, href: { pathname: '/chat/[id]', params: { id: 'last' } } }
    const agentId = params.get('to')
    return agentId && ROUTE_ID_PATTERN.test(agentId) ? { workspaceId, href: generalHref(agentId, null) } : null
}

let pending: ShortcutTarget | null = null
let taps = 0
const listeners = new Set<() => void>()

function publish(next: ShortcutTarget | null) {
    pending = next
    listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function holdShortcut(path: string): boolean {
    const link = readLink(path)
    if (!link) return false
    publish({ id: `shortcut-${++taps}`, ...link })
    return true
}

export function forgetShortcut(id: string) {
    if (pending?.id === id) publish(null)
}

export function usePendingShortcut(): ShortcutTarget | null {
    return useSyncExternalStore(subscribe, () => pending)
}
