import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryTables } from '@/ee/test/memory-table'
import { TEST_GOOGLE_CONFIG, TEST_PUSH_AUDIENCE, TEST_PUSH_SERVICE_ACCOUNT, pushBody } from '@/ee/test/google-payloads'

const m = vi.hoisted(() => ({ createServiceRoleClient: vi.fn(), handleGooglePlayNotification: vi.fn(), verifyIdToken: vi.fn() }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: m.createServiceRoleClient }))
vi.mock('@/ee/services/store-billing.service', () => ({ handleGooglePlayNotification: m.handleGooglePlayNotification }))
vi.mock('google-auth-library', () => ({
    OAuth2Client: class {
        verifyIdToken = m.verifyIdToken
    },
}))

import { POST } from './route'

let db: ReturnType<typeof memoryTables>

const notification = { subscriptionNotification: { version: '1.0', notificationType: 4, purchaseToken: 'token-1', subscriptionId: 'rerun.base.monthly' } }
const push = (body: unknown = pushBody(notification), authorization = 'Bearer oidc') => new Request('https://hub.test/api/webhooks/google-play', { method: 'POST', headers: { authorization }, body: JSON.stringify(body) })
const claims = () => db.tables.store_notifications!.rows

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('GOOGLE_PLAY_PRODUCT_ID', TEST_GOOGLE_CONFIG.productId)
    vi.stubEnv('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', JSON.stringify(TEST_GOOGLE_CONFIG.serviceAccount))
    vi.stubEnv('GOOGLE_PLAY_PUSH_AUDIENCE', TEST_PUSH_AUDIENCE)
    vi.stubEnv('GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT', TEST_PUSH_SERVICE_ACCOUNT)
    db = memoryTables({ store_notifications: { rows: [], primaryKey: ['provider', 'notification_id'] } })
    m.createServiceRoleClient.mockReturnValue(db.client)
    m.verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: TEST_PUSH_SERVICE_ACCOUNT, email_verified: true }) })
    m.handleGooglePlayNotification.mockResolvedValue('applied')
})

describe('POST /api/webhooks/google-play', () => {
    it('applies an authenticated push once, keyed by its Pub/Sub message id', async () => {
        const response = await POST(push())
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ received: true, outcome: 'applied' })
        expect(m.verifyIdToken).toHaveBeenCalledWith({ idToken: 'oidc', audience: TEST_PUSH_AUDIENCE })
        expect(m.handleGooglePlayNotification).toHaveBeenCalledWith(expect.objectContaining({ productId: 'rerun.base.monthly' }), expect.objectContaining(notification))
        expect(claims()).toEqual([expect.objectContaining({ provider: 'google', notification_id: 'msg-1', type: 'subscription/4', processed_at: expect.any(String) })])

        const replay = await POST(push())
        expect(await replay.json()).toEqual({ received: true, duplicate: true })
        expect(m.handleGooglePlayNotification).toHaveBeenCalledTimes(1)
    })

    it('answers 200 to a purchase no workspace of this hub holds, so Pub/Sub stops redelivering it', async () => {
        m.handleGooglePlayNotification.mockResolvedValue('unknown')
        const response = await POST(push())
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ received: true, outcome: 'unknown' })
    })

    it('refuses a push without Google token, or from another account', async () => {
        expect((await POST(push(undefined, ''))).status).toBe(401)
        m.verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'attacker@evil.iam.gserviceaccount.com', email_verified: true }) })
        expect((await POST(push())).status).toBe(401)
        m.verifyIdToken.mockRejectedValue(new Error('Invalid token signature'))
        expect((await POST(push())).status).toBe(401)
        expect(m.handleGooglePlayNotification).not.toHaveBeenCalled()
        expect(claims()).toEqual([])
    })

    it('releases the claim and answers 500 when the handler fails, so Pub/Sub retries', async () => {
        m.handleGooglePlayNotification.mockRejectedValueOnce(new Error('Play API down'))
        expect((await POST(push())).status).toBe(500)
        expect(claims()).toEqual([])
        expect((await POST(push())).status).toBe(200)
    })

    it('acknowledges a message that will never parse', async () => {
        const response = await POST(push({ message: { messageId: 'm', data: '%%%' } }))
        expect(response.status).toBe(200)
        expect(m.handleGooglePlayNotification).not.toHaveBeenCalled()
    })

    it('answers 500 while Google Play is not configured, so nothing is lost', async () => {
        vi.stubEnv('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', '')
        expect((await POST(push())).status).toBe(500)
    })
})
