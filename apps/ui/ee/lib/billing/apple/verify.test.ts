import { VerificationException, VerificationStatus } from '@apple/app-store-server-library'
import { describe, expect, it } from 'vitest'
import { TEST_APPLE_VERIFIER_OPTIONS, signAppleJws, unsignedXcodeJws } from '@/ee/test/apple-signing'
import { TEST_APPLE_CONFIG, appleNotification, appleRenewalInfo, appleTransaction } from '@/ee/test/apple-payloads'
import { isAppleVerificationFailure, verifyAppleNotification, verifyAppleRenewalInfo, verifyAppleTransaction } from './verify'

const options = TEST_APPLE_VERIFIER_OPTIONS

async function statusOf(promise: Promise<unknown>): Promise<VerificationStatus | 'ok'> {
    try {
        await promise
        return 'ok'
    } catch (err) {
        if (err instanceof VerificationException) return err.status
        throw err
    }
}

describe('verifyAppleTransaction', () => {
    it('verifies a sandbox transaction and says it came from the sandbox', async () => {
        const { payload, environment } = await verifyAppleTransaction(TEST_APPLE_CONFIG, signAppleJws(appleTransaction()), options)
        expect(environment).toBe('Sandbox')
        expect(payload.originalTransactionId).toBe('2000000001')
        expect(payload.offerDiscountType).toBe('FREE_TRIAL')
    })

    it('verifies a production transaction against the app id', async () => {
        const { environment } = await verifyAppleTransaction(TEST_APPLE_CONFIG, signAppleJws(appleTransaction({ environment: 'Production' })), options)
        expect(environment).toBe('Production')
    })

    it('refuses a transaction of another app', async () => {
        expect(await statusOf(verifyAppleTransaction(TEST_APPLE_CONFIG, signAppleJws(appleTransaction({ bundleId: 'com.other.app' })), options))).toBe(VerificationStatus.INVALID_APP_IDENTIFIER)
    })

    it('refuses a payload altered after it was signed', async () => {
        const [header, , signature] = signAppleJws(appleTransaction()).split('.')
        const forged = `${header}.${Buffer.from(JSON.stringify(appleTransaction({ expiresDate: Date.now() + 365 * 86_400_000 }))).toString('base64url')}.${signature}`
        const status = await statusOf(verifyAppleTransaction(TEST_APPLE_CONFIG, forged, options))
        expect(status).toBe(VerificationStatus.VERIFICATION_FAILURE)
    })

    it('refuses a chain that does not lead to the pinned root', async () => {
        // Apple's real root is the default: the test chain does not chain to it.
        const status = await statusOf(verifyAppleTransaction(TEST_APPLE_CONFIG, signAppleJws(appleTransaction()), { onlineChecks: false }))
        expect(status).toBe(VerificationStatus.VERIFICATION_FAILURE)
    })

    it('refuses an Xcode transaction unless the hub accepts local StoreKit testing', async () => {
        const xcode = unsignedXcodeJws(appleTransaction({ environment: 'Xcode' }))
        expect(await statusOf(verifyAppleTransaction(TEST_APPLE_CONFIG, xcode, options))).toBe(VerificationStatus.INVALID_ENVIRONMENT)
        const { environment } = await verifyAppleTransaction({ ...TEST_APPLE_CONFIG, acceptXcode: true }, xcode, options)
        expect(environment).toBe('Xcode')
    })

    it('refuses a payload that claims no environment', async () => {
        expect(await statusOf(verifyAppleTransaction(TEST_APPLE_CONFIG, signAppleJws(appleTransaction({ environment: undefined })), options))).toBe(VerificationStatus.INVALID_ENVIRONMENT)
        expect(await statusOf(verifyAppleTransaction(TEST_APPLE_CONFIG, 'not-a-jws', options))).toBe(VerificationStatus.INVALID_ENVIRONMENT)
    })
})

describe('verifyAppleRenewalInfo', () => {
    it('verifies the renewal info in the environment of its transaction', async () => {
        const renewal = await verifyAppleRenewalInfo(TEST_APPLE_CONFIG, 'Sandbox', signAppleJws(appleRenewalInfo({ autoRenewStatus: 0 })), options)
        expect(renewal.autoRenewStatus).toBe(0)
    })
})

describe('verifyAppleNotification', () => {
    it('verifies a notification and reads its environment from its data', async () => {
        const signed = signAppleJws(appleNotification('SUBSCRIBED', 'INITIAL_BUY', { signedTransactionInfo: signAppleJws(appleTransaction()) }))
        const { payload, environment } = await verifyAppleNotification(TEST_APPLE_CONFIG, signed, options)
        expect(environment).toBe('Sandbox')
        expect(payload.notificationType).toBe('SUBSCRIBED')
    })

    it('verifies a production notification only for this app id', async () => {
        const signed = signAppleJws(appleNotification('DID_RENEW', undefined, {}, { data: { appAppleId: 1, bundleId: TEST_APPLE_CONFIG.bundleId, environment: 'Production' } }))
        expect(await statusOf(verifyAppleNotification(TEST_APPLE_CONFIG, signed, options))).toBe(VerificationStatus.INVALID_APP_IDENTIFIER)
    })
})

describe('isAppleVerificationFailure', () => {
    it('tells a payload that will never verify from a failure worth retrying', () => {
        expect(isAppleVerificationFailure(new VerificationException(VerificationStatus.VERIFICATION_FAILURE))).toBe(true)
        expect(isAppleVerificationFailure(new VerificationException(VerificationStatus.RETRYABLE_VERIFICATION_FAILURE))).toBe(false)
        expect(isAppleVerificationFailure(new Error('network'))).toBe(false)
    })
})
