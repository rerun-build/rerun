import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { loadRecipient } from './recipient'

function client(result: { data: { user: Record<string, unknown> | null }; error: unknown }) {
    return { auth: { admin: { getUserById: async () => result } }, rpc: async () => ({ data: false, error: null }) } as unknown as SupabaseClient<Database>
}

function withUser(user: Record<string, unknown>) {
    return client({ data: { user: { is_anonymous: false, email: 'ada@acme.io', user_metadata: {}, ...user } }, error: null })
}

describe('loadRecipient', () => {
    it('returns nothing on a lookup error', async () => {
        await expect(loadRecipient(client({ data: { user: null }, error: { message: 'boom' } }), 'u')).resolves.toBeNull()
    })

    it('returns nothing for an anonymous visitor', async () => {
        await expect(loadRecipient(withUser({ is_anonymous: true }), 'u')).resolves.toBeNull()
    })

    it('returns nothing for a blank address', async () => {
        await expect(loadRecipient(withUser({ email: '   ' }), 'u')).resolves.toBeNull()
    })

    it('trims the address', async () => {
        await expect(loadRecipient(withUser({ email: ' ada@acme.io ' }), 'u')).resolves.toEqual({ email: 'ada@acme.io', firstName: null })
    })

    it.each([
        [{ first_name: ' Ada ', given_name: 'Grace' }, 'Ada'],
        [{ given_name: 'Grace', full_name: 'Alan Turing' }, 'Grace'],
        [{ full_name: 'Alan  Turing' }, 'Alan'],
        [{ name: 'Linus Torvalds' }, 'Linus'],
        [{ first_name: 42, name: 'Linus' }, 'Linus'],
        [{ full_name: '   ' }, null],
        [{}, null],
    ])('reads the first name from %j', async (metadata, expected) => {
        const recipient = await loadRecipient(withUser({ user_metadata: metadata }), 'u')

        expect(recipient?.firstName).toBe(expected)
    })
})
