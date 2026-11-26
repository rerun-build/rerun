import { afterEach, describe, expect, it, vi } from 'vitest'
import { androidPasskeyApps, iosPasskeyApps } from './passkey-apps'

describe('passkey apps', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('names none on a hub that sets nothing', () => {
        vi.stubEnv('PASSKEY_IOS_APP_IDS', '')
        vi.stubEnv('PASSKEY_ANDROID_APPS', '')
        expect(iosPasskeyApps()).toEqual([])
        expect(androidPasskeyApps()).toEqual([])
    })

    it('reads the apps and their signing fingerprints', () => {
        vi.stubEnv('PASSKEY_IOS_APP_IDS', 'ABCDE12345.build.rerun.app, ABCDE12345.build.rerun.app.dev')
        vi.stubEnv('PASSKEY_ANDROID_APPS', 'build.rerun.app:AA:BB:CC')
        expect(iosPasskeyApps()).toEqual(['ABCDE12345.build.rerun.app', 'ABCDE12345.build.rerun.app.dev'])
        expect(androidPasskeyApps()).toEqual([{ packageName: 'build.rerun.app', fingerprint: 'AA:BB:CC' }])
    })
})
