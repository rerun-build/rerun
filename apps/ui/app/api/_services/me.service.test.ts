import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'

import { readMe } from './me.service'
vi.mock('@moldwright/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))

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
