import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/supabase/client', () => ({ createClient: () => ({ rpc }) }))

const { useCoworkerPreviewsStore } = await import('./coworker-previews.store')

const row = (agentId: string, sessionId: string | null, updatedAt: string | null, patch: Record<string, unknown> = {}) => ({
    agent_id: agentId,
    session_id: sessionId,
    title: sessionId,
    status: sessionId ? 'idle' : null,
    updated_at: updatedAt,
    last_message: null,
    last_message_from: null,
    last_message_at: null,
    last_message_author_id: null,
    ...patch,
})
const live = (id: string, agentId: string, updated_at: string, patch: Record<string, unknown> = {}) => ({ id, agent_id: agentId, title: id, status: 'idle' as const, updated_at, last_message: null, last_message_from: null, last_message_author_id: null, ...patch })
const answer = (data: unknown) => Promise.resolve({ data, error: null })

beforeEach(() => {
    useCoworkerPreviewsStore.getState().reset()
    rpc.mockReset()
})

describe('coworker previews', () => {
    it('reads one row per coworker from the database function, and skips one nobody talked to', async () => {
        rpc.mockReturnValue(answer([row('a', 's1', '2026-11-13T10:00:00+00:00', { title: 'Q4', last_message: 'Three leads found', last_message_from: 'agent' }), row('b', null, null)]))
        await useCoworkerPreviewsStore.getState().load(7)
        expect(rpc).toHaveBeenCalledWith('coworker_previews', { p_workspace_id: 7 })
        const state = useCoworkerPreviewsStore.getState()
        expect(state.loaded).toBe(true)
        expect(state.byAgent).toEqual({ a: { sessionId: 's1', title: 'Q4', status: 'idle', updatedAt: '2026-11-13T10:00:00+00:00', lastMessage: { text: 'Three leads found', from: 'agent', authorId: null } } })
    })

    it('has no last message for a conversation older than the column', async () => {
        rpc.mockReturnValue(answer([row('a', 's1', '2026-11-13T10:00:00+00:00')]))
        await useCoworkerPreviewsStore.getState().load(7)
        expect(useCoworkerPreviewsStore.getState().byAgent.a.lastMessage).toBeNull()
    })

    it('takes a newer conversation from the sessions channel, never an older one', async () => {
        rpc.mockReturnValue(answer([row('a', 's1', '2026-11-13T10:00:00+00:00')]))
        await useCoworkerPreviewsStore.getState().load(7)
        useCoworkerPreviewsStore.getState().applySession(live('s0', 'a', '2026-11-13T09:00:00+00:00'))
        expect(useCoworkerPreviewsStore.getState().byAgent.a.sessionId).toBe('s1')
        useCoworkerPreviewsStore.getState().applySession(live('s2', 'a', '2026-11-13T11:00:00.123456+00:00', { last_message: 'hi', last_message_from: 'user', last_message_author_id: 'me' }))
        expect(useCoworkerPreviewsStore.getState().byAgent.a).toMatchObject({ sessionId: 's2', lastMessage: { text: 'hi', from: 'user', authorId: 'me' } })
    })

    it('keeps a row the channel delivered while the read was in flight', async () => {
        let resolve: (value: unknown) => void = () => {}
        rpc.mockReturnValue(new Promise(done => (resolve = done)))
        const loading = useCoworkerPreviewsStore.getState().load(7)
        useCoworkerPreviewsStore.getState().applySession(live('fresh', 'a', '2026-11-13T12:00:00+00:00'))
        resolve({ data: [row('a', 'stale', '2026-11-13T10:00:00+00:00')], error: null })
        await loading
        expect(useCoworkerPreviewsStore.getState().byAgent.a.sessionId).toBe('fresh')
    })

    it('drops what a workspace left behind, and ignores a read answered after the switch', async () => {
        rpc.mockReturnValueOnce(answer([row('a', 's1', '2026-11-13T10:00:00+00:00')]))
        await useCoworkerPreviewsStore.getState().load(7)
        let resolve: (value: unknown) => void = () => {}
        rpc.mockReturnValueOnce(new Promise(done => (resolve = done)))
        const first = useCoworkerPreviewsStore.getState().load(8)
        expect(useCoworkerPreviewsStore.getState().byAgent).toEqual({})
        rpc.mockReturnValueOnce(answer([]))
        await useCoworkerPreviewsStore.getState().load(9)
        resolve({ data: [row('x', 'late', '2026-11-13T10:00:00+00:00')], error: null })
        await first
        expect(useCoworkerPreviewsStore.getState().byAgent).toEqual({})
    })

    it('keeps what it had when the read fails', async () => {
        rpc.mockReturnValueOnce(answer([row('a', 's1', '2026-11-13T10:00:00+00:00')]))
        await useCoworkerPreviewsStore.getState().load(7)
        rpc.mockReturnValueOnce(Promise.resolve({ data: null, error: { message: 'boom' } }))
        await useCoworkerPreviewsStore.getState().reload()
        expect(useCoworkerPreviewsStore.getState().byAgent.a.sessionId).toBe('s1')
    })

    it('is done loading after a first read that fails, so the list shows its coworkers anyway', async () => {
        rpc.mockReturnValueOnce(Promise.resolve({ data: null, error: { message: 'boom' } }))
        await useCoworkerPreviewsStore.getState().load(7)
        expect(useCoworkerPreviewsStore.getState()).toMatchObject({ workspaceId: 7, byAgent: {}, loaded: true })
    })

    it('listens to nothing while no workspace is loaded', () => {
        useCoworkerPreviewsStore.getState().applySession(live('s1', 'a', '2026-11-13T10:00:00+00:00'))
        expect(useCoworkerPreviewsStore.getState().byAgent).toEqual({})
    })
})
