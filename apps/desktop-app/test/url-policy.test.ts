import { describe, expect, it } from 'vitest'
import { decideNavigation, decideWindowOpen, isInsecureServer, normalizeServerUrl } from '../src/main/url-policy'

const SERVER = 'https://app.rerun.build'

describe('decideNavigation', () => {
    it('keeps the server’s own pages in the window', () => {
        expect(decideNavigation('https://app.rerun.build/', SERVER)).toBe('stay')
        expect(decideNavigation('https://app.rerun.build/auth?next=/x', SERVER)).toBe('stay')
    })

    it('sends the rest of the web to the browser', () => {
        expect(decideNavigation('https://checkout.stripe.com/c/pay', SERVER)).toBe('external')
        expect(decideNavigation('http://example.com', SERVER)).toBe('external')
        expect(decideNavigation('mailto:hello@rerun.build', SERVER)).toBe('external')
    })

    it('treats a look-alike host or another port as another site', () => {
        expect(decideNavigation('https://app.rerun.build.evil.com/', SERVER)).toBe('external')
        expect(decideNavigation('https://app.rerun.build:8443/', SERVER)).toBe('external')
        expect(decideNavigation('http://app.rerun.build/', SERVER)).toBe('external')
    })

    it('goes nowhere for local files, scripts and other apps’ schemes', () => {
        expect(decideNavigation('file:///etc/passwd', SERVER)).toBe('deny')
        expect(decideNavigation('javascript:alert(1)', SERVER)).toBe('deny')
        expect(decideNavigation('rerun-shell://app/server.html', SERVER)).toBe('deny')
        expect(decideNavigation('smb://share/x', SERVER)).toBe('deny')
        expect(decideNavigation('not a url', SERVER)).toBe('deny')
    })
})

describe('decideWindowOpen', () => {
    it('keeps sign-in popups and the server’s pages in a child window of the same session', () => {
        expect(decideWindowOpen('about:blank', SERVER)).toBe('child')
        expect(decideWindowOpen('', SERVER)).toBe('child')
        expect(decideWindowOpen('https://app.rerun.build/published-auth?slug=x', SERVER)).toBe('child')
    })

    it('opens other sites in the browser and drops the rest', () => {
        expect(decideWindowOpen('https://docs.rerun.build', SERVER)).toBe('external')
        expect(decideWindowOpen('file:///tmp/x', SERVER)).toBe('deny')
    })
})

describe('normalizeServerUrl', () => {
    it('keeps the origin and adds https when the scheme is missing', () => {
        expect(normalizeServerUrl('rerun.example.com')).toBe('https://rerun.example.com')
        expect(normalizeServerUrl(' https://rerun.example.com/some/path?x=1 ')).toBe('https://rerun.example.com')
        expect(normalizeServerUrl('http://localhost:3050')).toBe('http://localhost:3050')
    })

    it('refuses what is not an http server', () => {
        expect(normalizeServerUrl('')).toBeNull()
        expect(normalizeServerUrl('ftp://rerun.example.com')).toBeNull()
        expect(normalizeServerUrl('javascript:alert(1)')).toBeNull()
        expect(normalizeServerUrl('https://user:pass@rerun.example.com')).toBeNull()
    })
})

describe('isInsecureServer', () => {
    it('only accepts plain http on this machine', () => {
        expect(isInsecureServer('http://rerun.example.com')).toBe(true)
        expect(isInsecureServer('http://localhost:3050')).toBe(false)
        expect(isInsecureServer('http://127.0.0.1:3050')).toBe(false)
        expect(isInsecureServer('https://rerun.example.com')).toBe(false)
    })
})
