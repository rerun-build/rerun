// @vitest-environment happy-dom
import { MAX_OPEN_CHATS, type ChangeOpenChatsInput, type OpenChats } from '@rerun/contracts'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ThreadRow } from '@/app/api/_services/conversation.service'
import type { useForemanStore as ForemanStore } from '@/stores/foreman.store'

import type { ForemanTabs } from './useForemanTabs'

vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ user: { id: 'ada' }, workspace: { id: 7 } }) }))
vi.mock('@/stores/board.store', () => ({ useBoardStore: { getState: () => ({ selectAgent: vi.fn(), selectSpace: vi.fn() }) } }))
vi.mock('@/lib/foreman-open', () => ({ rememberForemanOpen: vi.fn() }))
vi.mock('@/lib/foreman-layout', () => ({ rememberForemanPlacement: vi.fn() }))

const COMPUTER = '11111111-1111-4111-8111-111111111111'
const PHONE = '22222222-2222-4222-8222-222222222222'
const ASKED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ON_PHONE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const KEPT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MEMO_KEY = 'open-chats:ada:foreman:7'

const rowOf = (id: string): ThreadRow => ({ id, title: `Title ${id[0]}`, status: 'idle', source: 'dashboard', createdAt: '2026-11-24T09:00:00.000Z', updatedAt: '2026-11-24T09:00:00.000Z', originAgentId: null, automationName: null, outcome: null, firstMessage: null })

let root: Root
let store: typeof ForemanStore
let conversations: ForemanTabs
let show: (props: { onScreen: boolean; threads?: ThreadRow[] }) => Promise<void>
let bodies: ChangeOpenChatsInput[]
let onHub: OpenChats

// Every thread the hub is told of has a row but a draft's, which it leaves out.
async function hub(_url: string, init?: RequestInit) {
    if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as ChangeOpenChatsInput
        bodies.push(body)
        for (const id of body.merge ?? []) open(id)
        for (const change of body.changes ?? []) {
            if (change.type === 'close') onHub.chats = onHub.chats.filter(chat => chat.id !== change.sessionId)
            else {
                if (change.sessionId) open(change.sessionId)
                onHub.last = { activeId: change.sessionId, deviceId: COMPUTER, deviceKind: 'computer', changedAt: '2026-11-24T10:00:00.000Z' }
            }
        }
    }
    return Response.json(onHub)
}

function open(id: string) {
    if (!onHub.chats.some(chat => chat.id === id)) onHub.chats = [...onHub.chats, { id, title: `Title ${id[0]}` }]
}

const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))
const screenId = () => store.getState().sessionId
const threadIds = () => conversations.tabs.slice(1).map(tab => tab.id)
const selected = () => bodies.flatMap(body => body.changes ?? []).flatMap(change => (change.type === 'select' ? [change.sessionId] : []))

describe('the Chief of Staff conversations as its column comes on screen', () => {
    beforeEach(async () => {
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        vi.resetModules()
        vi.useFakeTimers()
        vi.stubGlobal('fetch', hub)
        localStorage.clear()
        localStorage.setItem('rerun-chat-device', COMPUTER)
        localStorage.setItem(MEMO_KEY, JSON.stringify({ pending: [], merged: true, dismissedAt: null }))
        bodies = []
        onHub = { chats: [{ id: ON_PHONE, title: 'On the phone' }], last: { activeId: ON_PHONE, deviceId: PHONE, deviceKind: 'phone', changedAt: '2026-11-24T09:00:00.000Z' } }

        const { useForemanTabs } = await import('./useForemanTabs')
        const { selectForemanInThread, useForemanStore } = await import('@/stores/foreman.store')
        store = useForemanStore
        store.getState().reset()
        store.getState().setSurface('engine')
        store.getState().setGeneral('general', 'engine')
        const { openThread, showGeneral } = store.getState()
        function Column({ onScreen, threads = [] }: { onScreen: boolean; threads?: ThreadRow[] }) {
            const sessionId = useForemanStore(state => state.sessionId)
            const draftId = useForemanStore(state => state.draftId)
            const threadOpenRequest = useForemanStore(state => state.threadOpenRequest)
            const inThread = useForemanStore(selectForemanInThread)
            conversations = useForemanTabs({ sessionId, inThread, draftId, blankDraft: draftId === sessionId, threadOpenRequest, threads, untitled: 'New conversation', onScreen, onShowGeneral: showGeneral, onOpenThread: openThread })
            return null
        }
        root = createRoot(document.createElement('div'))
        show = props => act(async () => root.render(createElement(Column, props)))
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('stays on the thread it was opened on, before its list of threads is read', async () => {
        await show({ onScreen: false })
        await act(async () => store.getState().openThread(ASKED))
        await show({ onScreen: true })
        await wait(1000)
        expect(screenId()).toBe(ASKED)
        expect(selected()).toEqual([ASKED])
        expect(conversations.resume).toBeNull()
    })

    it('stays on a thread asked for again, left on screen when the column closed', async () => {
        await show({ onScreen: false, threads: [rowOf(ASKED)] })
        await act(async () => store.getState().openThread(ASKED))
        await wait(10_000)
        onHub.last = { activeId: ON_PHONE, deviceId: PHONE, deviceKind: 'phone', changedAt: '2026-11-24T11:00:00.000Z' }
        await act(async () => store.getState().openThread(ASKED))
        await show({ onScreen: true, threads: [rowOf(ASKED)] })
        await wait(1000)
        expect(screenId()).toBe(ASKED)
    })

    it('opens on General with the offer when the column is only opened again', async () => {
        await show({ onScreen: false })
        await act(async () => store.getState().openThread(ASKED))
        await wait(10_000)
        onHub.last = { activeId: ON_PHONE, deviceId: PHONE, deviceKind: 'phone', changedAt: '2026-11-24T11:00:00.000Z' }
        await show({ onScreen: true })
        await wait(1000)
        expect(screenId()).toBe('general')
        expect(conversations.resume?.sessionId).toBe(ON_PHONE)
    })

    it('merges the tabs this browser kept, before its list of threads is read', async () => {
        localStorage.removeItem(MEMO_KEY)
        localStorage.setItem('session-tabs-foreman:7', JSON.stringify({ tabs: [{ uid: 'kept', id: KEPT, title: 'Kept' }], activeIndex: 0, pinned: 'general' }))
        await show({ onScreen: true })
        await wait(1000)
        expect(bodies[0].merge).toEqual([KEPT])
        expect(threadIds()).toEqual([ON_PHONE, KEPT])
    })

    it('closes none of them for a new conversation nobody has written in', async () => {
        const full = Array.from({ length: MAX_OPEN_CHATS }, (_, n) => `dddddddd-dddd-4ddd-8ddd-dddddddddd${String(n).padStart(2, '0')}`)
        onHub = { chats: full.map(id => ({ id, title: id })), last: null }
        await show({ onScreen: true })
        await wait(1000)
        bodies = []
        await act(async () => store.getState().newChat())
        await wait(1000)
        expect(bodies).toEqual([])
        expect(threadIds()).toEqual([...full, screenId()])
    })

    it('keeps a new conversation to itself until the hub has written it down', async () => {
        onHub = { chats: [], last: null }
        await show({ onScreen: true })
        await wait(1000)
        await act(async () => store.getState().newChat())
        const draft = screenId()
        await wait(1000)
        expect(selected()).toEqual([])
        expect(threadIds()).toEqual([draft])

        await show({ onScreen: true, threads: [rowOf(draft)] })
        await wait(1000)
        expect(selected()).toEqual([draft])
    })
})
