import 'server-only'

import {
    Environment,
    SignedDataVerifier,
    VerificationException,
    VerificationStatus,
    type JWSRenewalInfoDecodedPayload,
    type JWSTransactionDecodedPayload,
    type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library'
import type { AppleIapConfig } from './config'
import { appleRootCertificates } from './root-certificates'

export type AppleEnvironment = 'Production' | 'Sandbox' | 'Xcode'

type EnvironmentVerifier = { environment: AppleEnvironment; verifier: SignedDataVerifier }

// Tests hand their own chain in, signed by a local root, and skip the revocation check that would
// ask Apple's OCSP responder about it.
export type AppleVerifierOptions = { roots?: Buffer[]; onlineChecks?: boolean }

// Production and Sandbox both: App Review and every TestFlight build buy in the sandbox, against the
// production hub as much as the staging one. `store_environment` keeps which one a purchase came from.
export function createAppleVerifiers(config: AppleIapConfig, { roots = appleRootCertificates(), onlineChecks = true }: AppleVerifierOptions = {}): EnvironmentVerifier[] {
    const verifiers: EnvironmentVerifier[] = [
        { environment: 'Production', verifier: new SignedDataVerifier(roots, onlineChecks, Environment.PRODUCTION, config.bundleId, config.appAppleId) },
        { environment: 'Sandbox', verifier: new SignedDataVerifier(roots, onlineChecks, Environment.SANDBOX, config.bundleId) },
    ]
    if (config.acceptXcode) verifiers.push({ environment: 'Xcode', verifier: new SignedDataVerifier(roots, false, Environment.XCODE, config.bundleId) })
    return verifiers
}

let cached: { config: AppleIapConfig; verifiers: EnvironmentVerifier[] } | null = null

// One set per configuration: each verifier caches the intermediate certificates it already checked.
function verifiersFor(config: AppleIapConfig, options?: AppleVerifierOptions): EnvironmentVerifier[] {
    if (options) return createAppleVerifiers(config, options)
    if (cached?.config !== config) cached = { config, verifiers: createAppleVerifiers(config) }
    return cached.verifiers
}

// The environment a payload claims, read before it is verified so it goes to the one verifier that
// can check it: a Sandbox transaction would only fail Production's environment check, but an Xcode
// one fails its certificate check first. The verifier then holds the claim to its own environment.
function claimedEnvironment(jws: string, read: (payload: Record<string, unknown>) => unknown): string | null {
    try {
        const payload = JSON.parse(Buffer.from(jws.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
        const environment = read(payload)
        return typeof environment === 'string' ? environment : null
    } catch {
        return null
    }
}

function verifierClaimedBy(config: AppleIapConfig, claimed: string | null, options?: AppleVerifierOptions): EnvironmentVerifier {
    const match = verifiersFor(config, options).find(candidate => candidate.environment === claimed)
    if (!match) throw new VerificationException(VerificationStatus.INVALID_ENVIRONMENT)
    return match
}

export async function verifyAppleTransaction(config: AppleIapConfig, jws: string, options?: AppleVerifierOptions): Promise<{ payload: JWSTransactionDecodedPayload; environment: AppleEnvironment }> {
    const { environment, verifier } = verifierClaimedBy(config, claimedEnvironment(jws, payload => payload.environment), options)
    return { payload: await verifier.verifyAndDecodeTransaction(jws), environment }
}

export async function verifyAppleNotification(config: AppleIapConfig, signedPayload: string, options?: AppleVerifierOptions): Promise<{ payload: ResponseBodyV2DecodedPayload; environment: AppleEnvironment }> {
    const claimed = claimedEnvironment(signedPayload, payload => (payload.data as Record<string, unknown> | undefined)?.environment ?? (payload.summary as Record<string, unknown> | undefined)?.environment)
    const { environment, verifier } = verifierClaimedBy(config, claimed, options)
    return { payload: await verifier.verifyAndDecodeNotification(signedPayload), environment }
}

// The renewal info always travels with a transaction, in the environment that transaction came from.
export function verifyAppleRenewalInfo(config: AppleIapConfig, environment: AppleEnvironment, jws: string, options?: AppleVerifierOptions): Promise<JWSRenewalInfoDecodedPayload> {
    return verifierClaimedBy(config, environment, options).verifier.verifyAndDecodeRenewalInfo(jws)
}

// A transaction that does not verify is the caller's mistake or a forgery, never a reason to retry.
export function isAppleVerificationFailure(err: unknown): boolean {
    return err instanceof VerificationException && err.status !== VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
}
