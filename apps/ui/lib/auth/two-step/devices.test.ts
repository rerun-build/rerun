import { describe, expect, it } from 'vitest'
import { describeUserAgent } from './devices'

describe('describeUserAgent', () => {
    it('names a browser and its system', () => {
        expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')).toEqual({ app: 'browser', browser: 'Chrome', os: 'macOS', phone: false })
        expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15')).toMatchObject({ browser: 'Safari', os: 'macOS' })
        expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0')).toMatchObject({ browser: 'Edge', os: 'Windows' })
        expect(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0')).toMatchObject({ browser: 'Firefox', os: 'Linux' })
        expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toEqual({ app: 'browser', browser: 'Safari', os: 'iOS', phone: true })
    })

    it('knows the desktop app and the mobile app', () => {
        expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Electron/33.0.0 RerunDesktop/1.4.0 (win; stable)')).toEqual({ app: 'desktop', os: 'Windows' })
        expect(describeUserAgent('Mozilla/5.0 (Macintosh) Electron/33.0.0')).toEqual({ app: 'desktop', os: 'macOS' })
        expect(describeUserAgent('Rerun/38 CFNetwork/1568.100.1 Darwin/24.0.0')).toEqual({ app: 'ios' })
        expect(describeUserAgent('okhttp/4.12.0')).toEqual({ app: 'android' })
    })

    it('says nothing it cannot tell', () => {
        expect(describeUserAgent(null)).toEqual({ app: 'unknown' })
        expect(describeUserAgent('node')).toEqual({ app: 'unknown' })
    })
})
