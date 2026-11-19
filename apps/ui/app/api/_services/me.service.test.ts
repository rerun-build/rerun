import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'

import { loadMe, messageAuthorOf, readMe } from './me.service'
const getAuthUser = vi.fn()
vi.mock('@/supabase/session/getServerSession', () => ({ getAuthUser: () => getAuthUser() }))
vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))

const contextWith = (workspace: { subscription_status: string | null; is_sandbox: boolean }) =>
    ({
        userId: 'user-1',
        userEmail: 'ada@example.com',
        authUser: { user_metadata: {} },
        workspace: { id: 7, name: 'Acme', icon_url: null, plan: 'base', ...workspace },
    }) as unknown as WorkspaceContext

describe('readMe', () => {
    it('says the workspace is subscribed while a trial or a paid plan is in force', () => {
        expect(readMe(contextWith({ subscription_status: 'trialing', is_sandbox: false })).workspace.subscribed).toBe(true)
        expect(readMe(contextWith({ subscription_status: 'past_due', is_sandbox: false })).workspace.subscribed).toBe(true)
    })

    it('says it is not once the subscription is over, or before there was one', () => {
        expect(readMe(contextWith({ subscription_status: 'canceled', is_sandbox: false })).workspace.subscribed).toBe(false)
        expect(readMe(contextWith({ subscription_status: null, is_sandbox: false })).workspace.subscribed).toBe(false)
    })

    it('counts the expert sandbox as subscribed, as every other gate does', () => {
        expect(readMe(contextWith({ subscription_status: null, is_sandbox: true })).workspace.subscribed).toBe(true)
    })
})

describe('loadMe', () => {
    const context = (authUser: object) => ({ ...contextWith({ subscription_status: 'trialing', is_sandbox: false }), userLocale: 'fr', authUser }) as unknown as WorkspaceContext

    it('answers the language and the name the session already holds, with no read of its own', async () => {
        getAuthUser.mockReset()

        const me = await loadMe(context({ user_metadata: { full_name: 'Ada Lovelace' }, app_metadata: {} }))

        expect(me.user).toEqual(expect.objectContaining({ locale: 'fr', name: 'Ada Lovelace' }))
        expect(getAuthUser).not.toHaveBeenCalled()
    })

    it('asks the auth server for a name the token was issued before', async () => {
        getAuthUser.mockReset().mockResolvedValue({ user_metadata: { full_name: 'Ada', first_name: 'Ada' }, app_metadata: {} })

        const me = await loadMe(context({ user_metadata: {}, app_metadata: {} }))

        expect(me.user.name).toBe('Ada')
    })

    it('keeps what the token says when the auth server has nothing to add', async () => {
        getAuthUser.mockReset().mockResolvedValue(null)

        const me = await loadMe(context({ user_metadata: {}, app_metadata: {} }))

        expect(me.user.name).toBeNull()
    })
})

describe('messageAuthorOf', () => {
    it('names the member and the zone of their device, and leaves out what is not known', () => {
        const ctx = { userId: 'user-1', authUser: { user_metadata: { full_name: 'Ada Lovelace' } } } as unknown as WorkspaceContext
        expect(messageAuthorOf(ctx, 'Europe/Paris')).toEqual({ id: 'user-1', name: 'Ada Lovelace', timezone: 'Europe/Paris' })
        expect(messageAuthorOf({ ...ctx, authUser: { user_metadata: {} } } as unknown as WorkspaceContext)).toEqual({ id: 'user-1' })
    })
})
