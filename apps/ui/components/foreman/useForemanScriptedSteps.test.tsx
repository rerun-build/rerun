// @vitest-environment happy-dom
import type { UIMessage } from 'ai'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FakeSupabase } from '@/test/supabase-fake'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/hooks/useErrorText', () => ({ useErrorText: () => 'error' }))
vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ workspace: null }) }))
vi.mock('@/components/foreman/ForemanNextSteps', () => ({ startLeadInstall: vi.fn() }))
vi.mock('@/components/foreman/useForemanKickoff', () => ({ settleBuiltFunnel: vi.fn(() => Promise.resolve('skipped')) }))
vi.mock('@/lib/notifications/browser', () => ({ browserPermission: () => 'granted' }))
const db = vi.hoisted(() => ({ fake: undefined as unknown as FakeSupabase }))
vi.mock('@/supabase/client', async () => {
    const { fakeSupabase } = await import('@/test/supabase-fake')
    db.fake = fakeSupabase()
    return { createClient: () => db.fake.client }
})

import type { SpacePublic } from '@/lib/board/types'
import { useBoardStore } from '@/stores/board.store'
import { useForemanScriptedSteps } from './useForemanScriptedSteps'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const INITIAL = useBoardStore.getState()

const space = (id: string): SpacePublic => ({ id, workspace_id: 7, name: id, col_start: 0, row_start: 0, col_end: 3, row_end: 3, created_at: '' })

function built(...boxIds: string[]): UIMessage[] {
    return [{ id: 'm1', role: 'assistant', parts: [{ type: 'tool-build_team', toolCallId: 'call-1', state: 'output-available', output: { boxes: boxIds.map(boxId => ({ boxId })), agents: [], failed: [], lead: null } }] } as unknown as UIMessage]
}

function Probe({ messages }: { messages: UIMessage[] }) {
    useForemanScriptedSteps({ messages, status: 'ready', guided: false, restoreDone: true, send: () => true })
    return null
}

let root: Root
let container: HTMLElement
let spy: ReturnType<typeof vi.fn>

function render(messages: UIMessage[]) {
    act(() => root.render(<Probe messages={messages} />))
}

function arrive(...ids: string[]) {
    act(() => useBoardStore.setState({ spaces: ids.map(space) }))
}

function advance(ms: number) {
    act(() => {
        vi.advanceTimersByTime(ms)
    })
}

beforeEach(() => {
    vi.useFakeTimers()
    useBoardStore.setState(INITIAL, true)
    spy = vi.fn()
    useBoardStore.setState({ recenterBoard: spy as unknown as () => void, spaces: [] })
    container = document.createElement('div')
    root = createRoot(container)
    render([])
})

afterEach(() => {
    act(() => root.unmount())
    vi.useRealTimers()
})

describe('useForemanScriptedSteps recentring', () => {
    it('recentres when the new boxes arrive, not at 400 ms', () => {
        render(built('box-a', 'box-b'))
        advance(50)
        expect(spy).not.toHaveBeenCalled()
        arrive('box-a', 'box-b')
        expect(spy).toHaveBeenCalledTimes(1)
        advance(5000)
        expect(spy).toHaveBeenCalledTimes(1)
    })

    it('waits for every new box, not the first one', () => {
        render(built('box-a', 'box-b'))
        arrive('box-a')
        expect(spy).not.toHaveBeenCalled()
        arrive('box-a', 'box-b')
        expect(spy).toHaveBeenCalledTimes(1)
    })

    it('recentres at once when the boxes are already on the board', () => {
        arrive('box-a')
        render(built('box-a'))
        expect(spy).toHaveBeenCalledTimes(1)
        advance(5000)
        expect(spy).toHaveBeenCalledTimes(1)
    })

    it('recentres once at the 2000 ms fallback when they never arrive', () => {
        render(built('box-a'))
        advance(1999)
        expect(spy).not.toHaveBeenCalled()
        advance(1)
        expect(spy).toHaveBeenCalledTimes(1)
        arrive('box-a')
        advance(5000)
        expect(spy).toHaveBeenCalledTimes(1)
    })

    it('keeps waiting across re-renders while the stream adds messages', () => {
        const messages = built('box-a')
        render(messages)
        render([...messages, { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] } as UIMessage])
        render([...messages, { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'hi there' }] } as UIMessage])
        expect(spy).not.toHaveBeenCalled()
        arrive('box-a')
        expect(spy).toHaveBeenCalledTimes(1)
    })

    it('leaves no timer and no subscription behind when unmounted before they arrive', () => {
        render(built('box-a'))
        act(() => root.unmount())
        expect(vi.getTimerCount()).toBe(0)
        root = createRoot(container)
        arrive('box-a')
        advance(5000)
        expect(spy).not.toHaveBeenCalled()
    })
})
