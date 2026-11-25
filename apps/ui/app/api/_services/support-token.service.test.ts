import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase } from '@/test/supabase-fake'

const support = vi.hoisted(() => ({ SUPPORT_CHAT_ENABLED: true }))
vi.mock('@rerun/cloud/support', () => support)

const { supportChatTokenOf } = await import('./support-token.service')

const KEYS: Record<string, string | null> = { 'user-ada': 'key-ada', 'user-grace': 'key-grace', 'user-deleted': null }

function usersTable() {
    return fakeSupabase((table, calls) => {
        if (table !== 'users') return undefined
        const id = calls.find(call => call.method === 'eq' && call.args[0] === 'id')?.args[1] as string
        return { data: id in KEYS ? { support_token: KEYS[id] } : null }
    })
}

beforeEach(() => {
    support.SUPPORT_CHAT_ENABLED = true
})

describe('supportChatTokenOf', () => {
    it('reads the key of that person, and writes nothing', async () => {
        const db = usersTable()

        await expect(supportChatTokenOf(db.client, 'user-ada')).resolves.toBe('key-ada')
        await expect(supportChatTokenOf(db.client, 'user-grace')).resolves.toBe('key-grace')
        expect(db.writes('users')).toEqual([])
    })

    it('has no key for a deleted account, nor for one without a row yet', async () => {
        const db = usersTable()

        await expect(supportChatTokenOf(db.client, 'user-deleted')).resolves.toBeNull()
        await expect(supportChatTokenOf(db.client, 'user-unknown')).resolves.toBeNull()
    })

    it('reads nothing where there is no support chat', async () => {
        support.SUPPORT_CHAT_ENABLED = false
        const db = usersTable()

        await expect(supportChatTokenOf(db.client, 'user-ada')).resolves.toBeNull()
        expect(db.calls).toEqual([])
    })

    it('leaves the chat without a key rather than failing the page', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const db = fakeSupabase(() => ({ error: { message: 'column does not exist' } }))

        await expect(supportChatTokenOf(db.client, 'user-ada')).resolves.toBeNull()
    })
})
