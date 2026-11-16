import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FOREMAN_HUB_TOKEN_TTL_MS, FOREMAN_WAKE_TOKEN_TTL_MS, foremanHubTokenRequired, mintForemanHubToken, mintForemanWakeToken, verifyForemanHubToken } from './hub-token'

const WORKSPACE_ID = 42

function tamper(token: string, claims: Record<string, unknown>): string {
    const [payload, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')), ...claims })).toString('base64url')
    return `${forged}.${signature}`
}

beforeEach(() => {
    vi.stubEnv('FOREMAN_HUB_TOKEN_SECRET', 'test-secret')
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

describe('foreman hub token', () => {
    // A run nobody started reads and proposes: its token says so, for one hour.
    it('carries the wake scope of a run nobody started, and dies after an hour', () => {
        const token = mintForemanWakeToken(WORKSPACE_ID, 'member-1')!
        expect(verifyForemanHubToken(token, WORKSPACE_ID)).toMatchObject({ uid: 'member-1', scope: 'wake' })
        expect(verifyForemanHubToken(mintForemanHubToken(WORKSPACE_ID, 'member-1'), WORKSPACE_ID)).not.toHaveProperty('scope')
        vi.advanceTimersByTime(FOREMAN_WAKE_TOKEN_TTL_MS + 1)
        expect(verifyForemanHubToken(token, WORKSPACE_ID)).toBeNull()
    })

    it('cannot be widened by dropping its scope', () => {
        const token = mintForemanWakeToken(WORKSPACE_ID, 'member-1')!
        expect(verifyForemanHubToken(tamper(token, { scope: undefined }), WORKSPACE_ID)).toBeNull()
    })

    it('round-trips for the workspace it was minted for', () => {
        expect(verifyForemanHubToken(mintForemanHubToken(WORKSPACE_ID), WORKSPACE_ID)).not.toBeNull()
    })

    it('refuses a token minted for another workspace', () => {
        expect(verifyForemanHubToken(mintForemanHubToken(WORKSPACE_ID), 7)).toBeNull()
    })

    it('refuses a rewritten, truncated or empty token', () => {
        const token = mintForemanHubToken(WORKSPACE_ID)!
        expect(verifyForemanHubToken(tamper(token, { ws: 7 }), 7)).toBeNull()
        expect(verifyForemanHubToken(tamper(token, { exp: Date.now() + 10 * FOREMAN_HUB_TOKEN_TTL_MS }), WORKSPACE_ID)).toBeNull()
        expect(verifyForemanHubToken(token.split('.')[0], WORKSPACE_ID)).toBeNull()
        expect(verifyForemanHubToken(`${token}.extra`, WORKSPACE_ID)).toBeNull()
        expect(verifyForemanHubToken('', WORKSPACE_ID)).toBeNull()
        expect(verifyForemanHubToken(null, WORKSPACE_ID)).toBeNull()
    })

    it('refuses a token signed with another secret', () => {
        const token = mintForemanHubToken(WORKSPACE_ID)
        vi.stubEnv('FOREMAN_HUB_TOKEN_SECRET', 'rotated-secret')
        expect(verifyForemanHubToken(token, WORKSPACE_ID)).toBeNull()
    })

    it('expires after twelve hours', () => {
        const token = mintForemanHubToken(WORKSPACE_ID)
        vi.advanceTimersByTime(FOREMAN_HUB_TOKEN_TTL_MS - 1_000)
        expect(verifyForemanHubToken(token, WORKSPACE_ID)).not.toBeNull()
        vi.advanceTimersByTime(2_000)
        expect(verifyForemanHubToken(token, WORKSPACE_ID)).toBeNull()
    })

    it('mints nothing and accepts nothing without a secret', () => {
        const token = mintForemanHubToken(WORKSPACE_ID)
        vi.stubEnv('FOREMAN_HUB_TOKEN_SECRET', '')
        expect(mintForemanHubToken(WORKSPACE_ID)).toBeNull()
        expect(verifyForemanHubToken(token, WORKSPACE_ID)).toBeNull()
    })

    it('is required as soon as the hub holds a secret, unless told to tolerate', () => {
        vi.stubEnv('FOREMAN_HUB_TOKEN_REQUIRED', '')
        expect(foremanHubTokenRequired()).toBe(true)
        vi.stubEnv('FOREMAN_HUB_TOKEN_REQUIRED', '1')
        expect(foremanHubTokenRequired()).toBe(true)
        vi.stubEnv('FOREMAN_HUB_TOKEN_REQUIRED', '0')
        expect(foremanHubTokenRequired()).toBe(false)
        vi.stubEnv('FOREMAN_HUB_TOKEN_REQUIRED', '')
        vi.stubEnv('FOREMAN_HUB_TOKEN_SECRET', '')
        expect(foremanHubTokenRequired()).toBe(false)
    })

    it('carries the member the turn speaks for, and none for a workspace token', () => {
        expect(verifyForemanHubToken(mintForemanHubToken(WORKSPACE_ID, 'user-7'), WORKSPACE_ID)?.uid).toBe('user-7')
        expect(verifyForemanHubToken(mintForemanHubToken(WORKSPACE_ID), WORKSPACE_ID)?.uid).toBeUndefined()
    })
})
