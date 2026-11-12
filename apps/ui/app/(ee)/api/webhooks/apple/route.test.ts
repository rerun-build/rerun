import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryTables } from '@/ee/test/memory-table'
import { signAppleJws } from '@/ee/test/apple-signing'
import { TEST_APPLE_CONFIG, appleNotification, appleTransaction } from '@/ee/test/apple-payloads'

const m = vi.hoisted(() => ({ createServiceRoleClient: vi.fn(), handleAppleNotification: vi.fn() }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: m.createServiceRoleClient }))
vi.mock('@/ee/services/store-billing.service', async importOriginal => ({
    InvalidStorePurchaseError: (await importOriginal<typeof import('@/ee/services/store-billing.service')>()).InvalidStorePurchaseError,
    handleAppleNotification: m.handleAppleNotification,
}))
vi.mock('@/ee/lib/billing/apple/verify', async importOriginal => {
    const actual = await importOriginal<typeof import('@/ee/lib/billing/apple/verify')>()
    const { TEST_APPLE_VERIFIER_OPTIONS } = await import('@/ee/test/apple-signing')
    return { ...actual, verifyAppleNotification: (config: never, payload: string) => actual.verifyAppleNotification(config, payload, TEST_APPLE_VERIFIER_OPTIONS) }
})

import { InvalidStorePurchaseError } from '@/ee/services/store-billing.service'
import { POST } from './route'

let db: ReturnType<typeof memoryTables>

const notification = appleNotification('SUBSCRIBED', 'INITIAL_BUY', { signedTransactionInfo: signAppleJws(appleTransaction()) }, { notificationUUID: 'n-1' })
const request = (body: unknown) => new Request('https://hub.test/api/webhooks/apple', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
const signed = (payload: object = notification) => request({ signedPayload: signAppleJws(payload) })
const claims = () => db.tables.store_notifications!.rows

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('APPLE_IAP_PRODUCT_ID', TEST_APPLE_CONFIG.productId)
    vi.stubEnv('APPLE_APP_APPLE_ID', String(TEST_APPLE_CONFIG.appAppleId))
    db = memoryTables({ store_notifications: { rows: [], primaryKey: ['provider', 'notification_id'] } })
    m.createServiceRoleClient.mockReturnValue(db.client)
    m.handleAppleNotification.mockResolvedValue('applied')
})

describe('POST /api/webhooks/apple', () => {
    it('applies a verified notification once and stamps it processed', async () => {
        const response = await POST(signed())
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ received: true, outcome: 'applied' })
        expect(m.handleAppleNotification).toHaveBeenCalledWith(expect.objectContaining({ productId: 'rerun.base.monthly' }), expect.objectContaining({ notificationUUID: 'n-1', notificationType: 'SUBSCRIBED' }))
        expect(claims()).toEqual([expect.objectContaining({ provider: 'apple', notification_id: 'n-1', type: 'SUBSCRIBED/INITIAL_BUY', processed_at: expect.any(String) })])
    })

    it('drops a redelivery of a processed notification', async () => {
        await POST(signed())
        const replay = await POST(signed())
        expect(replay.status).toBe(200)
        expect(await replay.json()).toEqual({ received: true, duplicate: true })
        expect(m.handleAppleNotification).toHaveBeenCalledTimes(1)
    })

    it('answers 409 to a delivery that arrives while the first one still runs', async () => {
        db.tables.store_notifications!.rows.push({ provider: 'apple', notification_id: 'n-1', type: 'SUBSCRIBED/INITIAL_BUY', claimed_at: new Date().toISOString(), processed_at: null })
        const response = await POST(signed())
        expect(response.status).toBe(409)
        expect(m.handleAppleNotification).not.toHaveBeenCalled()
    })

    it('takes over a claim left by a delivery that died past its lease', async () => {
        db.tables.store_notifications!.rows.push({ provider: 'apple', notification_id: 'n-1', type: 'SUBSCRIBED/INITIAL_BUY', claimed_at: new Date(Date.now() - 10 * 60_000).toISOString(), processed_at: null })
        expect((await POST(signed())).status).toBe(200)
        expect(m.handleAppleNotification).toHaveBeenCalledTimes(1)
    })

    it('releases the claim and answers 500 when the handler fails, so Apple retries', async () => {
        m.handleAppleNotification.mockRejectedValueOnce(new Error('database down'))
        const response = await POST(signed())
        expect(response.status).toBe(500)
        expect(claims()).toEqual([])
        expect((await POST(signed())).status).toBe(200)
    })

    it('acknowledges a notification about a product the hub does not sell', async () => {
        m.handleAppleNotification.mockRejectedValueOnce(new InvalidStorePurchaseError('unknown product'))
        const response = await POST(signed())
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ received: true, outcome: 'ignored' })
        expect(claims()[0]?.processed_at).toEqual(expect.any(String))
    })

    it('refuses a payload that does not verify, without claiming it', async () => {
        const [header, , signature] = signAppleJws(notification).split('.')
        const forged = `${header}.${Buffer.from(JSON.stringify({ ...notification, notificationType: 'REFUND' })).toString('base64url')}.${signature}`
        expect((await POST(request({ signedPayload: forged }))).status).toBe(400)
        expect(claims()).toEqual([])
        expect(m.handleAppleNotification).not.toHaveBeenCalled()
    })

    it('refuses a body without a signed payload', async () => {
        expect((await POST(request({}))).status).toBe(400)
        expect((await POST(request('not json'))).status).toBe(400)
    })

    it('answers 500 while the App Store is not configured, so nothing is lost', async () => {
        vi.stubEnv('APPLE_IAP_PRODUCT_ID', '')
        expect((await POST(signed())).status).toBe(500)
    })
})
