import type { Conversation } from '@rerun/contracts'

import { GENERAL_THREAD_LIMIT, generalThreadsOf } from '@/components/chat/threads/general-threads'

const conversation = (id: string | null, createdAt: string | undefined, extra: Partial<Conversation> = {}): Conversation => ({ id, agentId: 'a', engineSessionId: `engine-${id}`, title: `${id} title`, status: 'idle', source: 'dashboard', updatedAt: '2026-11-10T09:00:00Z', originAgentName: null, kind: 'thread', createdAt, ...extra })

describe('generalThreadsOf', () => {
    it('keeps the threads with their opening message, General left out', () => {
        const threads = generalThreadsOf([conversation('g', '2026-11-08T08:00:00Z', { kind: 'general' }), conversation('t', '2026-11-08T10:00:00Z', { firstMessage: 'Plan the posts', automationName: null, outcome: null })])
        expect(threads).toEqual([{ id: 't', title: 't title', status: 'idle', source: 'dashboard', automationName: null, outcome: null, originAgentName: null, createdAt: '2026-11-08T10:00:00Z', firstMessage: 'Plan the posts' }])
    })

    it('leaves out a conversation nobody adopted yet, and one from a hub that does not date it', () => {
        expect(generalThreadsOf([conversation(null, '2026-11-08T10:00:00Z'), conversation('old', undefined)])).toEqual([])
    })

    it('keeps the newest ones, as the web does', () => {
        const many = Array.from({ length: GENERAL_THREAD_LIMIT + 5 }, (_, i) => conversation(`t${i}`, new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString()))
        const threads = generalThreadsOf(many)
        expect(threads).toHaveLength(GENERAL_THREAD_LIMIT)
        expect(threads[0].id).toBe(`t${GENERAL_THREAD_LIMIT + 4}`)
        expect(threads.some(thread => thread.id === 't0')).toBe(false)
    })
})
