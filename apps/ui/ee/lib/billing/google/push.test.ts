import { describe, expect, it, vi } from 'vitest'
import { TEST_GOOGLE_CONFIG, TEST_PUSH_AUDIENCE, TEST_PUSH_SERVICE_ACCOUNT, pushBody } from '@/ee/test/google-payloads'
import { isAuthenticPush, readPushMessage } from './push'

describe('isAuthenticPush', () => {
    const verify = vi.fn()

    it('trusts a token Google minted for the push subscription account and this audience', async () => {
        verify.mockResolvedValue({ email: TEST_PUSH_SERVICE_ACCOUNT, email_verified: true })
        expect(await isAuthenticPush(TEST_GOOGLE_CONFIG, 'Bearer token', verify)).toBe(true)
        expect(verify).toHaveBeenCalledWith('token', TEST_PUSH_AUDIENCE)
    })

    it('refuses another account, an unverified email, a token that does not verify, or none', async () => {
        verify.mockResolvedValue({ email: 'someone@else.iam.gserviceaccount.com', email_verified: true })
        expect(await isAuthenticPush(TEST_GOOGLE_CONFIG, 'Bearer token', verify)).toBe(false)
        verify.mockResolvedValue({ email: TEST_PUSH_SERVICE_ACCOUNT, email_verified: false })
        expect(await isAuthenticPush(TEST_GOOGLE_CONFIG, 'Bearer token', verify)).toBe(false)
        verify.mockRejectedValue(new Error('Wrong recipient, payload audience != requiredAudience'))
        expect(await isAuthenticPush(TEST_GOOGLE_CONFIG, 'Bearer token', verify)).toBe(false)
        expect(await isAuthenticPush(TEST_GOOGLE_CONFIG, null, verify)).toBe(false)
        expect(await isAuthenticPush(TEST_GOOGLE_CONFIG, 'Basic abc', verify)).toBe(false)
    })

    it('refuses everything while the push is not configured', async () => {
        verify.mockResolvedValue({ email: TEST_PUSH_SERVICE_ACCOUNT, email_verified: true })
        expect(await isAuthenticPush({ ...TEST_GOOGLE_CONFIG, pushAudience: null }, 'Bearer token', verify)).toBe(false)
        expect(await isAuthenticPush({ ...TEST_GOOGLE_CONFIG, pushServiceAccount: null }, 'Bearer token', verify)).toBe(false)
    })
})

describe('readPushMessage', () => {
    it('decodes the developer notification a Pub/Sub push carries', () => {
        const message = readPushMessage(pushBody({ subscriptionNotification: { version: '1.0', notificationType: 4, purchaseToken: 'token-1', subscriptionId: 'rerun.base.monthly' } }, 'msg-7'))
        expect(message).toMatchObject({ messageId: 'msg-7', notification: { packageName: 'build.rerun.app', subscriptionNotification: { notificationType: 4, purchaseToken: 'token-1' } } })
    })

    it('reads nothing from a body that is not a push', () => {
        expect(readPushMessage({})).toBeNull()
        expect(readPushMessage({ message: { messageId: '1', data: '%%%' } })).toBeNull()
        expect(readPushMessage(null)).toBeNull()
    })
})
