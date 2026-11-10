import { CLIENT_PLATFORMS, deviceTokenSchema, formatClientHeader, parseClientHeader } from '@rerun/contracts'
import { Platform } from 'react-native'

import { clientHeader } from '@/api/client'

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.4.0', nativeBuildVersion: '41' }))

const TOKEN = 'ExponentPushToken[abc-123]'

describe.each(CLIENT_PLATFORMS)('the %s client', platform => {
    it('names its platform, version and build in the header, and reads it back', () => {
        const header = formatClientHeader({ platform, version: '1.4.0', build: 41 })
        expect(header).toBe(`${platform}/1.4.0 (41)`)
        expect(parseClientHeader(header)).toEqual({ platform, version: '1.4.0', build: 41 })
    })

    it('registers its push token', () => {
        expect(deviceTokenSchema.parse({ token: TOKEN, platform, appVersion: '1.4.0 (41)' })).toEqual({ token: TOKEN, platform, appVersion: '1.4.0 (41)' })
    })
})

describe('the client header', () => {
    it('is the platform the app runs on', () => {
        expect(clientHeader).toBe(`${Platform.OS}/1.4.0 (41)`)
    })

    it('reads nothing from a header no app sends', () => {
        expect(parseClientHeader(null)).toBeNull()
        expect(parseClientHeader('curl/8')).toBeNull()
        expect(parseClientHeader('windows/1.0.0 (1)')).toBeNull()
        expect(parseClientHeader('android/1.0.0')).toBeNull()
    })
})

describe('deviceTokenSchema', () => {
    it('refuses a platform the app does not ship on', () => {
        expect(deviceTokenSchema.safeParse({ token: TOKEN, platform: 'web' }).success).toBe(false)
    })
})
