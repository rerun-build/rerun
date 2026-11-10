import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, writeMethodOf, type FakeSupabase } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({ getServerSession: vi.fn() }))
const RECIPIENT = vi.hoisted(() => 'user-recipient')

vi.mock('@/supabase/session/getServerSession', () => ({ getServerSession: mocks.getServerSession, getSessionWorkspace: mocks.getServerSession }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
// The signature itself is tested with the token module: here a token is either the good one or not.
vi.mock('@rerun/cloud/email', () => ({ verifyUnsubscribeToken: (token: string) => (token === `token-of-${RECIPIENT}` ? { userId: RECIPIENT, scope: null } : null) }))

const { createServiceRoleClient } = await import('@/supabase/serviceRole')
const { updateNotificationPrefsAction, updateNotificationPrefsByTokenAction } = await import('./notifications.actions')

const SIGNED_IN = 'user-signed-in'

let db: FakeSupabase

beforeEach(() => {
    vi.clearAllMocks()
    db = fakeSupabase((table, calls) => (table === 'users' && !writeMethodOf(calls) ? { data: { email_notification_prefs: { sound: true, categories: { billing: true, product: true } } } } : undefined))
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    mocks.getServerSession.mockResolvedValue({ user: { id: SIGNED_IN } })
})

afterEach(() => vi.unstubAllEnvs())

describe('updateNotificationPrefsByTokenAction', () => {
    it('writes the merged preferences of the token user only, whoever is signed in', async () => {
        await expect(updateNotificationPrefsByTokenAction(`token-of-${RECIPIENT}`, { categories: { product: false } })).resolves.toEqual({ ok: true })

        const reads = db.chainsOn('users').filter(chain => !writeMethodOf(chain))
        expect(reads[0]).toContainEqual({ table: 'users', method: 'eq', args: ['id', RECIPIENT] })
        const [write] = db.writes('users')
        expect(write.filters.map(call => call.args)).toEqual([['id', RECIPIENT]])
        expect(write.payload).toMatchObject({ email_notification_prefs: { sound: true, categories: { billing: true, product: false } } })
        expect(mocks.getServerSession).not.toHaveBeenCalled()
    })

    it('refuses a tampered token without writing', async () => {
        const token = `token-of-${RECIPIENT}`

        await expect(updateNotificationPrefsByTokenAction(`${token}x`, { sound: false })).resolves.toEqual({ ok: false, error: 'Invalid or expired link', code: 'linkInvalidOrExpired' })
        expect(db.writes('users')).toHaveLength(0)
    })

    it('refuses a patch that does not match the preferences schema', async () => {
        await expect(updateNotificationPrefsByTokenAction(`token-of-${RECIPIENT}`, { sound: 'loud' } as never)).resolves.toEqual({ ok: false, error: 'Invalid preferences', code: 'invalidPreferences' })
        expect(db.writes('users')).toHaveLength(0)
    })
})

describe('updateNotificationPrefsAction', () => {
    it('writes the preferences of the signed-in user', async () => {
        await expect(updateNotificationPrefsAction({ sound: false })).resolves.toEqual({ ok: true })

        const [write] = db.writes('users')
        expect(write.filters.map(call => call.args)).toEqual([['id', SIGNED_IN]])
        expect(write.payload).toMatchObject({ email_notification_prefs: { sound: false } })
    })

    it('refuses a visitor who is not signed in', async () => {
        mocks.getServerSession.mockResolvedValue({ user: null })

        await expect(updateNotificationPrefsAction({ sound: false })).resolves.toEqual({ ok: false, error: 'Not authenticated', code: 'notAuthenticated' })
        expect(db.writes('users')).toHaveLength(0)
    })

    it('refuses an invalid patch before reading the session', async () => {
        await expect(updateNotificationPrefsAction({ scope: 'loud' } as never)).resolves.toEqual({ ok: false, error: 'Invalid preferences', code: 'invalidPreferences' })
        expect(mocks.getServerSession).not.toHaveBeenCalled()
    })
})
