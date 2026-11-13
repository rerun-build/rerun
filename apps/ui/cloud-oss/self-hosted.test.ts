import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_ADMIN_EMAILS } from './admin'
import { activeAgentLimitFor, BILLING_ENABLED, isMachineEntitled, isPaidSubscription, isSubscriptionEntitled, isWorkspaceApiEntitled } from './billing'
import { RERUN_CLOUD } from './edition'
import { DESKTOP_DIRECT } from './engines'
import { ILLUSTRATION_ENTRIES } from './illustrations'
import { MARKETPLACE_ENABLED } from './marketplace'
import { PHONE_ENABLED } from './phone'
import { DEFAULT_SENDERS, DEFAULT_WHATSAPP_FROM } from './senders'
import { SERVERS_ENABLED } from './servers'
import { SUPPORT_CHAT_ENABLED } from './support'

// What a checkout without `cloud/` runs: a self-hosted install that sells nothing, sends no email of
// its own, has its own servers and nobody of Rerun's behind a chat.
describe('the self-hosted side of @rerun/cloud', () => {
    it('is not Rerun Cloud and sells nothing', () => {
        expect(RERUN_CLOUD).toBe(false)
        expect(BILLING_ENABLED).toBe(false)
        expect(MARKETPLACE_ENABLED).toBe(false)
    })

    it('entitles every workspace to everything, with no limit but one set by hand', () => {
        for (const status of [null, 'canceled', 'trialing', 'active']) {
            expect(isSubscriptionEntitled(status)).toBe(true)
            expect(isMachineEntitled(status)).toBe(true)
            expect(isPaidSubscription(status)).toBe(true)
        }
        expect(isWorkspaceApiEntitled({ subscription_status: null, is_sandbox: true })).toBe(true)
        expect(activeAgentLimitFor(null, 'canceled')).toBeNull()
        expect(activeAgentLimitFor(4, null)).toBe(4)
    })

    it('brings its own servers, reached directly', () => {
        expect(SERVERS_ENABLED).toBe(true)
        expect(DESKTOP_DIRECT).toBe(true)
    })

    it('has no phone check, no support chat, no built-in admin and no illustration library', () => {
        expect(PHONE_ENABLED).toBe(false)
        expect(SUPPORT_CHAT_ENABLED).toBe(false)
        expect(DEFAULT_ADMIN_EMAILS).toEqual([])
        expect(ILLUSTRATION_ENTRIES).toEqual([])
    })
})

describe('the email of a self-hosted install', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    it('goes out through its own Resend account once it has a key', async () => {
        vi.stubEnv('RESEND_API_KEY', 're_test_key')
        const email = await import('./email')
        expect(email.EMAIL_DELIVERY).toBe(true)
    })

    it('sends from no domain of Rerun until its own senders are set, and has no WhatsApp number', () => {
        for (const sender of [DEFAULT_SENDERS.transactional, DEFAULT_SENDERS.experts, DEFAULT_SENDERS.marketing]) expect(sender).toBe('Rerun <onboarding@resend.dev>')
        expect(DEFAULT_SENDERS.replyTo).toBeUndefined()
        expect(DEFAULT_WHATSAPP_FROM).toBeNull()
    })

    it('goes nowhere without one, so an invitation hands its link to whoever sent it', async () => {
        vi.stubEnv('RESEND_API_KEY', '')
        const email = await import('./email')
        expect(email.EMAIL_DELIVERY).toBe(false)
        expect(await email.sendWorkspaceInviteEmail({ to: 'ada@acme.com', workspaceName: 'Acme', inviteUrl: 'http://localhost:3000/invite/x' })).toEqual({ ok: true, id: null })
    })
})
