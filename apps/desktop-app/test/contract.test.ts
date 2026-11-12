import { describe, expect, it } from 'vitest'
import { compareShellVersions, desktopShellScheme, desktopShellUserAgentToken, parseDesktopShellUserAgent } from '@rerun/contracts'

describe('the desktop User-Agent token', () => {
    it('round-trips through the server’s parser', () => {
        const token = desktopShellUserAgentToken({ version: '0.4.1', platform: 'win', channel: 'staging' })
        const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 ${token}`
        expect(parseDesktopShellUserAgent(userAgent)).toEqual({ version: '0.4.1', platform: 'win', channel: 'staging' })
    })

    it('is absent from a browser', () => {
        expect(parseDesktopShellUserAgent('Mozilla/5.0 (Macintosh) Chrome/156.0.0.0 Safari/537.36')).toBeNull()
        expect(parseDesktopShellUserAgent(null)).toBeNull()
        expect(parseDesktopShellUserAgent('RerunDesktop/1.0 (amiga; stable)')).toBeNull()
    })
})

describe('compareShellVersions', () => {
    it('orders versions numerically, a prerelease before its release', () => {
        expect(compareShellVersions('0.10.0', '0.9.9')).toBe(1)
        expect(compareShellVersions('1.0.0', '1.0.0')).toBe(0)
        expect(compareShellVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
        expect(compareShellVersions('0.0.0', '0.1.0')).toBe(-1)
    })
})

describe('desktopShellScheme', () => {
    it('gives each channel its own scheme and leaves rerun:// to the mobile app', () => {
        expect(desktopShellScheme('stable')).toBe('rerun-desktop')
        expect(desktopShellScheme('staging')).toBe('rerun-desktop-staging')
        expect(desktopShellScheme('dev')).toBe('rerun-desktop-dev')
    })
})
