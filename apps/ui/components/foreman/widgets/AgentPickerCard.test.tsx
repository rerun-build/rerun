import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, type SupabaseResolver } from '@/test/supabase-fake'

const board = vi.hoisted(() => ({
    state: { selectedAgentId: null as string | null, focusAgentOnBoard: vi.fn(), setPendingOpenSession: vi.fn() },
    supabase: null as ReturnType<typeof fakeSupabase> | null,
}))

vi.mock('@/stores/board.store', () => ({ useBoardStore: { getState: () => board.state } }))
vi.mock('@/supabase/client', () => ({ createClient: () => board.supabase!.client }))
vi.mock('./AgentPickerList', () => ({ AgentPickerList: () => null }))

const { openAgentPick } = await import('./AgentPickerCard')

const CONVERSATION = '4dfbb571-8f9a-4ff2-810c-11e414cb8569'
const ENGINE_SESSION = '3ovpbq4znpvo17t1in2bs'

function rows(resolve: SupabaseResolver) {
    board.supabase = fakeSupabase(resolve)
    return board.supabase
}

// Focusing selects the coworker on the real store; the fake does the same so the late-answer guard
// sees the coworker the row opened.
function focusSelects() {
    board.state.focusAgentOnBoard.mockImplementation((agentId: string) => {
        board.state.selectedAgentId = agentId
    })
}

async function settled() {
    await new Promise(resolve => setTimeout(resolve, 0))
}

describe('openAgentPick', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        board.state.selectedAgentId = null
        focusSelects()
    })

    it('opens a conversation named by its row straight away, without a lookup', () => {
        const supabase = rows(() => undefined)

        openAgentPick({ agentId: 'agent-scout', tab: 'chat', conversationId: CONVERSATION, runId: 'run-1' })

        expect(board.state.focusAgentOnBoard).toHaveBeenCalledWith('agent-scout', 'chat')
        expect(board.state.setPendingOpenSession).toHaveBeenCalledWith({ agentId: 'agent-scout', sessionId: CONVERSATION, runId: 'run-1' })
        expect(supabase.calls).toEqual([])
    })

    it("finds the row of a conversation named by the engine's session id, and opens that", async () => {
        const supabase = rows(table => (table === 'sessions' ? { data: { id: CONVERSATION } } : undefined))

        openAgentPick({ agentId: 'agent-scout', tab: 'chat', conversationId: ENGINE_SESSION, runId: 'run-1' })
        expect(board.state.setPendingOpenSession).not.toHaveBeenCalled()
        await settled()

        expect(supabase.chainsOn('sessions')[0]).toEqual(
            expect.arrayContaining([
                { table: 'sessions', method: 'eq', args: ['agent_id', 'agent-scout'] },
                { table: 'sessions', method: 'eq', args: ['engine_session_id', ENGINE_SESSION] },
            ]),
        )
        expect(board.state.setPendingOpenSession).toHaveBeenCalledWith({ agentId: 'agent-scout', sessionId: CONVERSATION, runId: 'run-1' })
    })

    it('leaves the chat on its tab when no row carries that engine session id', async () => {
        rows(() => ({ data: null }))

        openAgentPick({ agentId: 'agent-scout', tab: 'chat', conversationId: ENGINE_SESSION, runId: null })
        await settled()

        expect(board.state.setPendingOpenSession).not.toHaveBeenCalled()
    })

    it('says so, and opens nothing, when the lookup fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        rows(() => ({ error: { message: 'permission denied' } }))

        openAgentPick({ agentId: 'agent-scout', tab: 'chat', conversationId: ENGINE_SESSION, runId: null })
        await settled()

        expect(warn).toHaveBeenCalled()
        expect(board.state.setPendingOpenSession).not.toHaveBeenCalled()
        warn.mockRestore()
    })

    it('drops a row found after the user moved on to another coworker', async () => {
        rows(() => ({ data: { id: CONVERSATION } }))

        openAgentPick({ agentId: 'agent-scout', tab: 'chat', conversationId: ENGINE_SESSION, runId: null })
        board.state.selectedAgentId = 'agent-ledger'
        await settled()

        expect(board.state.setPendingOpenSession).not.toHaveBeenCalled()
    })
})
