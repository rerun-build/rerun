import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, writeMethodOf, type SupabaseCall } from '@/test/supabase-fake'

const support = vi.hoisted(() => ({ SUPPORT_CHAT_ENABLED: true }))
vi.mock('@rerun/cloud/support', () => support)

const { supportChatTokenOf } = await import('./support-token.service')

const USER = 'user-ada'

// The table as Postgres keeps it: one row per person, the key drawn by the database on insert, an
// insert that finds the row already there leaves it as it is.
function tokenTable(rows: { user_id: string; token: string }[] = [], fail = false) {
    let drawn = 0
    return fakeSupabase((table, calls: readonly SupabaseCall[]) => {
        if (table !== 'user_support_tokens') return undefined
        if (fail) return { error: { message: 'relation does not exist' } }
        const userId = calls.find(call => call.method === 'eq' && call.args[0] === 'user_id')?.args[1]
        if (writeMethodOf(calls) === 'upsert') {
            const { user_id } = calls.find(call => call.method === 'upsert')!.args[0] as { user_id: string }
            if (!rows.some(row => row.user_id === user_id)) rows.push({ user_id, token: `token-${++drawn}` })
            return { data: null }
        }
        return { data: rows.find(row => row.user_id === userId) ?? null }
    })
}

beforeEach(() => {
    support.SUPPORT_CHAT_ENABLED = true
})

describe('supportChatTokenOf', () => {
    it('makes the key the first time, then hands back the same one on every device', async () => {
        const db = tokenTable()

        const first = await supportChatTokenOf(db.client, USER)
        const second = await supportChatTokenOf(db.client, USER)

        expect(first).toBe('token-1')
        expect(second).toBe(first)
        expect(db.writes('user_support_tokens').map(write => write.method)).toEqual(['upsert'])
    })

    it('never replaces a key already made', async () => {
        const db = tokenTable([{ user_id: USER, token: 'kept' }])

        await expect(supportChatTokenOf(db.client, USER)).resolves.toBe('kept')
        expect(db.writes('user_support_tokens')).toEqual([])
    })

    it('gives each person a key of their own', async () => {
        const db = tokenTable()

        const ada = await supportChatTokenOf(db.client, USER)
        const grace = await supportChatTokenOf(db.client, 'user-grace')

        expect(grace).not.toBe(ada)
    })

    it('makes no key where there is no support chat', async () => {
        support.SUPPORT_CHAT_ENABLED = false
        const db = tokenTable()

        await expect(supportChatTokenOf(db.client, USER)).resolves.toBeNull()
        expect(db.calls).toEqual([])
    })

    it('leaves the chat without a key rather than failing the page', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const db = tokenTable([], true)

        await expect(supportChatTokenOf(db.client, USER)).resolves.toBeNull()
    })
})
