// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@/hooks/useAgentModel'

const OPUS = { connectionId: 'claude-1', model: 'claude-opus-5-5', effort: null }

// Picks a model the way a chat's picker does, through the hook.
async function pick(agentId: string, selection: ModelSelection, conversationId?: string) {
    const { useAgentModel } = await import('@/hooks/useAgentModel')
    let select!: (next: ModelSelection) => void
    function Picker() {
        select = useAgentModel(agentId, conversationId).select
        return null
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(createElement(Picker)))
    act(() => select(selection))
    act(() => root.unmount())
}

describe('useAgentModel per conversation', () => {
    beforeEach(() => {
        vi.resetModules()
        localStorage.clear()
    })

    it('keeps two conversations of one coworker apart', async () => {
        const { readAgentModel } = await import('@/hooks/useAgentModel')
        await pick('coworker', OPUS, 'session-a')
        expect(readAgentModel('coworker', 'session-a')).toEqual(OPUS)
        expect(readAgentModel('coworker', 'session-b')).toEqual({})
        expect(readAgentModel('coworker')).toEqual({})
    })

    it('keeps the pick of a conversation across a reload', async () => {
        await pick('coworker', OPUS, 'session-a')
        vi.resetModules()
        const reloaded = await import('@/hooks/useAgentModel')
        expect(reloaded.readAgentModel('coworker', 'session-a')).toEqual(OPUS)
    })

    it('keeps the pick of a new chat in memory only, and hands it to the session the chat opens', async () => {
        const { adoptDraftModel, draftConversationId, readAgentModel } = await import('@/hooks/useAgentModel')
        const draft = draftConversationId('tab-1')
        await pick('coworker', OPUS, draft)
        expect(readAgentModel('coworker', draft)).toEqual(OPUS)
        expect(localStorage.length).toBe(0)

        adoptDraftModel('coworker', draft, 'session-a')
        expect(readAgentModel('coworker', 'session-a')).toEqual(OPUS)
        expect(readAgentModel('coworker', draft)).toEqual({})
        expect(localStorage.length).toBe(1)
    })

    it('leaves a new chat that picked nothing on the coworker default once its session opens', async () => {
        const { adoptDraftModel, draftConversationId, readAgentModel } = await import('@/hooks/useAgentModel')
        adoptDraftModel('coworker', draftConversationId('tab-1'), 'session-a')
        expect(readAgentModel('coworker', 'session-a')).toEqual({})
        expect(localStorage.length).toBe(0)
    })

    it('never writes over a pick the session already has', async () => {
        const { adoptDraftModel, draftConversationId, readAgentModel } = await import('@/hooks/useAgentModel')
        const draft = draftConversationId('tab-1')
        await pick('coworker', OPUS, 'session-a')
        await pick('coworker', { ...OPUS, model: 'claude-sonnet-5-5' }, draft)
        adoptDraftModel('coworker', draft, 'session-a')
        expect(readAgentModel('coworker', 'session-a')).toEqual(OPUS)
        expect(readAgentModel('coworker', draft)).toEqual({})
    })

    it('leaves nothing in the browser for a conversation back on the default', async () => {
        await pick('coworker', OPUS, 'session-a')
        expect(localStorage.length).toBe(1)
        await pick('coworker', {}, 'session-a')
        expect(localStorage.length).toBe(0)
        vi.resetModules()
        const reloaded = await import('@/hooks/useAgentModel')
        expect(reloaded.readAgentModel('coworker', 'session-a')).toEqual({})
    })
})
