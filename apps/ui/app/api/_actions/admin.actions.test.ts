import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ user: null as { email?: string } | null }))

vi.mock('@/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }) }))

import { isAdminAction } from './admin.actions'

beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_EMAILS', '')
    vi.stubEnv('ADMIN_EMAILS', 'owner@example.com')
})

afterEach(() => {
    vi.unstubAllEnvs()
    mocks.user = null
})

describe('isAdminAction', () => {
    it('answers true for a signed-in admin', async () => {
        mocks.user = { email: 'Owner@Example.com' }
        expect(await isAdminAction()).toBe(true)
    })

    it('answers false for anyone else', async () => {
        mocks.user = { email: 'someone@example.com' }
        expect(await isAdminAction()).toBe(false)
    })

    it('answers false when nobody is signed in', async () => {
        expect(await isAdminAction()).toBe(false)
    })
})
