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

describe('opening a page in the app', () => {
    it('takes a path of the server', () => {
        expect(parseDeepLink('rerun-desktop://open?path=%2Fagents%2Fabc%3Ftab%3Dchat', 'rerun-desktop')).toEqual({ kind: 'open', path: '/agents/abc?tab=chat' })
        expect(parseDeepLink('rerun-desktop://open?path=/', 'rerun-desktop')).toEqual({ kind: 'open', path: '/' })
    })

    it('refuses anything that would leave the server', () => {
        for (const path of ['https://evil.example/', '//evil.example/', '/\\evil.example', 'javascript:alert(1)', '/a b', '/\tx', '']) {
            expect(parseDeepLink(`rerun-desktop://open?path=${encodeURIComponent(path)}`, 'rerun-desktop')).toBeNull()
        }
    })
})
