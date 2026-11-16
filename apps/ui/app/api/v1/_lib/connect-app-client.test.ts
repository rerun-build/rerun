import { afterEach, describe, expect, it, vi } from 'vitest'

import { clientDrawsConnectApp } from './legacy-client'

const request = (headers: Record<string, string>) => new Request('https://app.rerun.build/api/chat/foreman/engine', { method: 'POST', headers })

describe('clientDrawsConnectApp', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('always lets the browser draw it', () => {
        expect(clientDrawsConnectApp(request({}))).toBe(true)
    })

    // The apps already installed show a bare tool step where the card should be.
    it('keeps it from a phone app until its first build is named', () => {
        expect(clientDrawsConnectApp(request({ authorization: 'Bearer t', 'x-rerun-client': 'ios/1.9.0 (90)' }))).toBe(false)
        expect(clientDrawsConnectApp(request({ authorization: 'Bearer t' }))).toBe(false)
        vi.stubEnv('MOBILE_IOS_CONNECT_APP_BUILD', '90')
        expect(clientDrawsConnectApp(request({ authorization: 'Bearer t', 'x-rerun-client': 'ios/1.9.0 (90)' }))).toBe(true)
        expect(clientDrawsConnectApp(request({ authorization: 'Bearer t', 'x-rerun-client': 'ios/1.8.0 (89)' }))).toBe(false)
        expect(clientDrawsConnectApp(request({ authorization: 'Bearer t', 'x-rerun-client': 'android/1.9.0 (90)' }))).toBe(false)
    })
})
