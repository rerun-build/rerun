import { describe, expect, it } from 'vitest'
import { deepLinkInArgv, parseDeepLink } from '../src/main/deep-links'

const CODE = 'a'.repeat(43)
const STATE = 'b'.repeat(32)

describe('parseDeepLink', () => {
    it('reads the sign-in callback of its own scheme', () => {
        expect(parseDeepLink(`rerun-desktop://auth/callback?code=${CODE}&state=${STATE}`, 'rerun-desktop')).toEqual({ kind: 'auth-callback', code: CODE, state: STATE })
    })

    it('refuses another channel’s scheme, another path and malformed values', () => {
        expect(parseDeepLink(`rerun-desktop-staging://auth/callback?code=${CODE}&state=${STATE}`, 'rerun-desktop')).toBeNull()
        expect(parseDeepLink(`rerun://auth/callback?code=${CODE}&state=${STATE}`, 'rerun-desktop')).toBeNull()
        expect(parseDeepLink(`rerun-desktop://auth/other?code=${CODE}&state=${STATE}`, 'rerun-desktop')).toBeNull()
        expect(parseDeepLink(`rerun-desktop://auth/callback?code=${CODE}`, 'rerun-desktop')).toBeNull()
        expect(parseDeepLink(`rerun-desktop://auth/callback?code=<script>&state=${STATE}`, 'rerun-desktop')).toBeNull()
        expect(parseDeepLink(`rerun-desktop://evil.com/callback?code=${CODE}&state=${STATE}`, 'rerun-desktop')).toBeNull()
        expect(parseDeepLink('not a url', 'rerun-desktop')).toBeNull()
    })
})

describe('deepLinkInArgv', () => {
    it('finds the link wherever Chromium put it among the arguments', () => {
        const link = `rerun-desktop://auth/callback?code=${CODE}&state=${STATE}`
        expect(deepLinkInArgv(['/Applications/Rerun.exe', '--allow-file-access', link, '--flag'], 'rerun-desktop')).toBe(link)
        expect(deepLinkInArgv(['/Applications/Rerun.exe', '--flag'], 'rerun-desktop')).toBeNull()
    })
})

describe('the service sign-in return', () => {
    it('carries the claim or the error back to the page', () => {
        expect(parseDeepLink('rerun-desktop://oauth/callback?status=success&claim=abcdefghijklmnopqrstuv', 'rerun-desktop')).toEqual({ kind: 'oauth-return', result: { status: 'success', claim: 'abcdefghijklmnopqrstuv' } })
        expect(parseDeepLink('rerun-desktop://oauth/callback?status=success', 'rerun-desktop')).toEqual({ kind: 'oauth-return', result: { status: 'success' } })
        expect(parseDeepLink('rerun-desktop://oauth/callback?status=error&message=Access%20denied', 'rerun-desktop')).toEqual({ kind: 'oauth-return', result: { status: 'error', message: 'Access denied' } })
    })

    it('drops a malformed claim or status', () => {
        expect(parseDeepLink('rerun-desktop://oauth/callback?status=success&claim=../../x', 'rerun-desktop')).toBeNull()
        expect(parseDeepLink('rerun-desktop://oauth/callback?status=maybe', 'rerun-desktop')).toBeNull()
    })
})
