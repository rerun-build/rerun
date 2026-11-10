import { fakeSupabase, writeMethodOf, type FakeSupabase } from '@/test/supabase-fake'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let holder: { user_id: string; revoked_at: string | null; last_seen_at: string } | null = null
let supabase: FakeSupabase = fakeSupabase()
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => supabase.client }))

let user: { id: string; is_anonymous: boolean } | null = { id: 'user-1', is_anonymous: false }
vi.mock('@/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
    getRequestAccessToken: async () => 'jwt',
}))

const { POST, DELETE } = await import('./route')

const segment = { params: Promise.resolve({}) }
const url = 'https://app.rerun.build/api/v1/me/devices'
const call = (handler: typeof POST, body: object) => handler(new Request(url, { method: 'POST', body: JSON.stringify(body) }), segment)
const TOKEN = 'ExponentPushToken[a-b_c]'
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60_000).toISOString()

describe('/api/v1/me/devices', () => {
    beforeEach(() => {
        user = { id: 'user-1', is_anonymous: false }
        holder = null
        supabase = fakeSupabase((table, calls) => (table === 'device_tokens' && !writeMethodOf(calls) ? { data: holder } : undefined))
    })

    it('registers the token of the caller, and wakes a revoked one of theirs', async () => {
        holder = { user_id: 'user-1', revoked_at: daysAgo(1), last_seen_at: daysAgo(1) }
        expect((await call(POST, { token: TOKEN, platform: 'ios', appVersion: '1.0.0 (7)' })).status).toBe(204)
        const [write] = supabase.writes('device_tokens')
        expect(write.method).toBe('upsert')
        expect(write.payload).toMatchObject({ user_id: 'user-1', token: TOKEN, platform: 'ios', app_version: '1.0.0 (7)', revoked_at: null })
    })

    it('registers an Android phone the same way', async () => {
        expect((await call(POST, { token: TOKEN, platform: 'android', appVersion: '1.0.0 (3)' })).status).toBe(204)
        expect(supabase.writes('device_tokens')[0].payload).toMatchObject({ token: TOKEN, platform: 'android', app_version: '1.0.0 (3)' })
        expect((await call(POST, { token: TOKEN, platform: 'windows' })).status).toBe(400)
    })

    it('moves a token to the new account of the phone once the previous one signed out or went quiet', async () => {
        holder = { user_id: 'user-2', revoked_at: daysAgo(2), last_seen_at: daysAgo(2) }
        expect((await call(POST, { token: TOKEN, platform: 'ios' })).status).toBe(204)
        holder = { user_id: 'user-2', revoked_at: null, last_seen_at: daysAgo(45) }
        expect((await call(POST, { token: TOKEN, platform: 'ios' })).status).toBe(204)
        expect(supabase.writes('device_tokens')).toHaveLength(2)
    })

    it('leaves a token another account still uses to that account', async () => {
        holder = { user_id: 'user-2', revoked_at: null, last_seen_at: daysAgo(3) }
        const res = await call(POST, { token: TOKEN, platform: 'ios' })
        expect(res.status).toBe(409)
        expect(await res.json()).toMatchObject({ error: 'This device is registered to another account.' })
        expect(supabase.writes('device_tokens')).toHaveLength(0)
    })

    it('revokes only the caller’s own token on sign-out', async () => {
        expect((await call(DELETE, { token: TOKEN, platform: 'ios' })).status).toBe(204)
        const [write] = supabase.writes('device_tokens')
        expect(write.method).toBe('update')
        expect(write.filters.map(filter => filter.args)).toEqual([
            ['token', TOKEN],
            ['user_id', 'user-1'],
        ])
    })

    it('refuses an empty token, one that is not an Expo token, and a signed-out caller', async () => {
        expect((await call(POST, { token: ' ', platform: 'ios' })).status).toBe(400)
        expect((await call(POST, { token: 'anything-at-all', platform: 'ios' })).status).toBe(400)
        user = null
        expect((await call(POST, { token: TOKEN, platform: 'ios' })).status).toBe(401)
        expect(supabase.writes('device_tokens')).toHaveLength(0)
    })
})
