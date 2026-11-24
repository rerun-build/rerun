// @vitest-environment happy-dom
import { MAX_OPEN_CHATS, type ChangeOpenChatsInput, type OpenChats } from '@rerun/contracts'
import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionTabs } from '@/hooks/useSessionTabs'

vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ user: { id: 'ada' } }) }))

const COMPUTER = '11111111-1111-4111-8111-111111111111'
const KEPT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ASKED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

let root: Root
let tabs: SessionTabs
let openOnHub: string[]
let changes: ChangeOpenChatsInput['changes'][]

async function hub(_url: string, init?: RequestInit) {
    if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as ChangeOpenChatsInput
        changes.push(body.changes)
        for (const change of body.changes ?? []) if (change.type === 'select' && change.sessionId && !openOnHub.includes(change.sessionId)) openOnHub.push(change.sessionId)
    }
    const answer: OpenChats = { chats: openOnHub.map(id => ({ id, title: null })), last: { activeId: KEPT, deviceId: COMPUTER, deviceKind: 'computer', changedAt: '2026-11-24T09:00:00.000Z' } }
    return Response.json(answer)
}

// As AgentPanelChat takes the conversation a notification asked for, as it mounts.
async function mount(asked?: string) {
    const { useSessionTabs } = await import('./useSessionTabs')
    const { useOpenChatsSync } = await import('./useOpenChatsSync')
    function Panel() {
        tabs = useSessionTabs('scout')
        const { openTab } = tabs
        const { stay } = useOpenChatsSync({ agentId: 'scout', storageKey: 'scout', tabs, onScreen: true })
        useEffect(() => {
            if (!asked) return
            stay()
            openTab(asked, 'From a notification')
        }, [openTab, stay])
        return null
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(Panel)))
    await wait(1000)
}

const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))
const threadIds = () => tabs.tabs.slice(1).map(tab => tab.id)

describe('the open conversations of a coworker that comes on screen', () => {
    beforeEach(() => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        vi.resetModules()
        vi.useFakeTimers()
        vi.stubGlobal('fetch', hub)
        localStorage.clear()
        localStorage.setItem('rerun-chat-device', COMPUTER)
        localStorage.setItem('session-tabs-scout', JSON.stringify({ tabs: [{ uid: 'kept', id: KEPT, title: 'Kept' }], activeIndex: 1, pinned: 'general' }))
        localStorage.setItem('open-chats:ada:scout', JSON.stringify({ pending: [], merged: true, dismissedAt: null }))
        openOnHub = [KEPT]
        changes = []
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('tells the hub of the one it was opened on, which stays once left', async () => {
        await mount(ASKED)
        expect(changes).toEqual([[{ type: 'select', sessionId: ASKED }]])
        expect(tabs.activeSessionId).toBe(ASKED)

        await act(async () => tabs.selectTab(1))
        await wait(6000)
        window.dispatchEvent(new Event('focus'))
        await wait(1000)
        expect(threadIds()).toEqual([KEPT, ASKED])
    })

    it('closes none of them for a new conversation nobody has written in', async () => {
        openOnHub = Array.from({ length: MAX_OPEN_CHATS }, (_, n) => `dddddddd-dddd-4ddd-8ddd-dddddddddd${String(n).padStart(2, '0')}`)
        await mount()
        await act(async () => tabs.createNew())
        await wait(1000)
        expect(changes).toEqual([])
        expect(threadIds()).toEqual([...openOnHub, null])
    })

    it('writes nothing when it only restores the one left here', async () => {
        await mount()
        expect(changes).toEqual([])
        expect(tabs.activeSessionId).toBe(KEPT)
    })
})
