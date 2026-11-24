import { MAX_OPEN_CHATS, mobileApi, type ChangeOpenChatsInput, type OpenChats } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { callRoute, contractContext, expectContract } from '@/test/mobile-contract'
import { fakeSupabase, tableResolver, writeMethodOf, type FakeSupabase } from '@/test/supabase-fake'

type Tables = Database['public']['Tables']
type Rows<T extends keyof Tables> = Partial<Tables[T]['Row']>[]

// The threads a person left open on a coworker, followed from one of their devices to the other. The
// service runs for real on a fake database that keeps what is written to it.
const state = vi.hoisted(() => ({ db: null as FakeSupabase | null, ctx: null as WorkspaceContext | null, rows: {} as Record<string, Record<string, unknown>[]> }))

vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => state.ctx,
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => state.db?.client }))

const SPACE = '3f2b8c1e-6a4d-4e9b-8f7a-2c5d1e9b0a47'
const SCOUT = '8d4e2a1f-3b6c-4d7e-9a8b-1c2d3e4f5a6b'
const LEDGER = 'b7c6d5e4-f3a2-4b1c-8d9e-0f1a2b3c4d5e'
const COS = 'd3c2b1a0-9f8e-4d7c-8b6a-5f4e3d2c1b0a'
const STRANGER = 'e1d2c3b4-a5f6-4e7d-8c9b-0a1b2c3d4e5f'
const threadId = (n: number) => `f6e5d4c3-b2a1-4f0e-9d8c-0000000000${String(n).padStart(2, '0')}`
const GENERAL = threadId(90)
const OF_LEDGER = threadId(91)
const MINE = threadId(92)
const OF_GRACE = threadId(93)
const UNKNOWN = threadId(99)

const COMPUTER = { id: '11111111-1111-4111-8111-111111111111', kind: 'computer' as const }
const PHONE = { id: '22222222-2222-4222-8222-222222222222', kind: 'phone' as const }

const agent = (id: string, workspaceId = 7): Rows<'agents'>[number] => ({ id, kind: 'coworker', workspace_id: workspaceId, space_id: SPACE, engine_agent_id: id })
const thread = (id: string, agentId: string, owner: string | null = null): Rows<'sessions'>[number] => ({ id, agent_id: agentId, kind: 'thread', title: `Thread ${id.slice(-2)}`, owner_user_id: owner })

const KEYS: Record<string, string[]> = { open_chats: ['user_id', 'session_id'], open_chat_states: ['user_id', 'agent_id'] }

// PostgREST's upsert and delete, on the two tables under test.
function database(): FakeSupabase {
    state.rows = {
        agents: [agent(SCOUT), agent(LEDGER), { ...agent(COS), kind: 'foreman', space_id: null, engine_agent_id: 'foreman' }, agent(STRANGER, 9)],
        spaces: [{ id: SPACE, workspace_id: 7, visibility: 'workspace' }],
        space_members: [],
        sessions: [...Array.from({ length: 12 }, (_, n) => thread(threadId(n), SCOUT)), { ...thread(GENERAL, SCOUT), kind: 'general' }, thread(OF_LEDGER, LEDGER), thread(MINE, COS, 'user-ada'), thread(OF_GRACE, COS, 'user-grace')],
        open_chats: [],
        open_chat_states: [],
    }
    return fakeSupabase((table, calls) => {
        const write = KEYS[table] && writeMethodOf(calls)
        if (write === 'upsert') {
            const call = calls.find(({ method }) => method === 'upsert')!
            const ignores = (call.args[1] as { ignoreDuplicates?: boolean }).ignoreDuplicates
            for (const row of [call.args[0]].flat() as Record<string, unknown>[]) {
                const at = state.rows[table].findIndex(held => KEYS[table].every(key => held[key] === row[key]))
                if (at === -1) state.rows[table].push(row)
                else if (!ignores) state.rows[table][at] = row
            }
            return { data: null }
        }
        if (write === 'delete') {
            const gone = new Set((tableResolver(state.rows)(table, calls.filter(({ method }) => method !== 'delete'))?.data ?? []) as object[])
            state.rows[table] = state.rows[table].filter(row => !gone.has(row))
            return { data: null }
        }
        return tableResolver(state.rows)(table, calls)
    })
}

async function read(id = SCOUT): Promise<OpenChats> {
    const { GET } = await import('@/app/api/v1/agents/[id]/open-chats/route')
    return (await expectContract(mobileApi.getOpenChats, await callRoute(GET, mobileApi.getOpenChats, { params: { id } }))) as OpenChats
}

async function change(body: ChangeOpenChatsInput, id = SCOUT): Promise<OpenChats> {
    const { POST } = await import('@/app/api/v1/agents/[id]/open-chats/route')
    return (await expectContract(mobileApi.changeOpenChats, await callRoute(POST, mobileApi.changeOpenChats, { params: { id }, body }))) as OpenChats
}

const select = (sessionId: string | null) => ({ type: 'select' as const, sessionId })
const close = (sessionId: string) => ({ type: 'close' as const, sessionId })
const openIds = (answer: OpenChats) => answer.chats.map(chat => chat.id)

describe('the conversations left open on a coworker', () => {
    beforeEach(() => {
        state.db = database()
        state.ctx = contractContext(state.db)
    })

    it('are none, with nothing picked, until a first one is', async () => {
        expect(await read()).toEqual({ chats: [], last: null })
    })

    it('follow what one device opens, picks and closes on the other', async () => {
        await change({ device: COMPUTER, changes: [select(threadId(1)), select(threadId(2))] })
        const onPhone = await read()
        expect(onPhone.chats).toEqual([{ id: threadId(1), title: 'Thread 01' }, { id: threadId(2), title: 'Thread 02' }])
        expect(onPhone.last).toMatchObject({ activeId: threadId(2), deviceId: COMPUTER.id, deviceKind: 'computer' })

        const closed = await change({ device: PHONE, changes: [close(threadId(2)), select(threadId(1))] })
        expect(openIds(closed)).toEqual([threadId(1)])
        expect((await read()).last).toMatchObject({ activeId: threadId(1), deviceId: PHONE.id, deviceKind: 'phone' })
    })

    it('keep who picked last when a device only closes, and read a closed pick as General', async () => {
        await change({ device: COMPUTER, changes: [select(threadId(1))] })
        expect((await change({ device: PHONE, changes: [close(threadId(1))] })).last).toMatchObject({ activeId: null, deviceId: COMPUTER.id })
    })

    it('keep the place of a thread picked again', async () => {
        await change({ device: COMPUTER, changes: [select(threadId(1)), select(threadId(2))] })
        expect(openIds(await change({ device: COMPUTER, changes: [select(threadId(1))] }))).toEqual([threadId(1), threadId(2)])
    })

    it('keep a thread closed then picked again in the same breath', async () => {
        await change({ device: COMPUTER, changes: [select(threadId(1))] })
        expect(openIds(await change({ device: COMPUTER, changes: [close(threadId(1)), select(threadId(1))] }))).toEqual([threadId(1)])
    })

    it('drop the oldest past the ceiling, never the one just picked', async () => {
        await change({ device: COMPUTER, changes: Array.from({ length: MAX_OPEN_CHATS }, (_, n) => select(threadId(n))) })
        expect(openIds(await change({ device: COMPUTER, changes: [select(threadId(10)), select(threadId(0))] }))).toEqual([0, 2, 3, 4, 5, 6, 7, 10].map(threadId))
    })

    it('take in what a device held before its first sync, in the room left', async () => {
        await change({ device: COMPUTER, changes: Array.from({ length: MAX_OPEN_CHATS - 2 }, (_, n) => select(threadId(n))) })
        const merged = await change({ device: PHONE, merge: [threadId(0), threadId(9), threadId(10), threadId(11)] })
        expect(openIds(merged)).toEqual([0, 1, 2, 3, 4, 5, 10, 11].map(threadId))
        expect(merged.last?.deviceId).toBe(COMPUTER.id)
    })

    it('leave out General, another coworker’s thread and one nobody knows', async () => {
        expect(await change({ device: COMPUTER, changes: [select(GENERAL), select(OF_LEDGER), select(UNKNOWN)], merge: [UNKNOWN] })).toEqual({ chats: [], last: null })
    })

    it('are each member’s own, the threads of the Chief of Staff included', async () => {
        await change({ device: COMPUTER, changes: [select(MINE), select(OF_GRACE)] }, 'foreman')
        expect(openIds(await read('foreman'))).toEqual([MINE])
        expect(state.rows.open_chats[0].agent_id).toBe(COS)

        await change({ device: COMPUTER, changes: [select(threadId(1))] })
        state.ctx = contractContext(state.db!, { userId: 'user-grace' })
        expect(await read()).toEqual({ chats: [], last: null })
    })

    it('answer a coworker of another workspace as missing, and refuse a body they cannot read', async () => {
        const { GET, POST } = await import('@/app/api/v1/agents/[id]/open-chats/route')
        await expectContract(mobileApi.getOpenChats, await callRoute(GET, mobileApi.getOpenChats, { params: { id: STRANGER } }), 404)
        await expectContract(mobileApi.changeOpenChats, await callRoute(POST, mobileApi.changeOpenChats, { params: { id: SCOUT }, body: { device: COMPUTER, changes: [select('general')] } }), 400)
    })
})
