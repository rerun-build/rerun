import { render } from '@testing-library/react-native'
import { ANDROID_PUSH_CHANNELS, FOREMAN_AGENT_ID } from '@rerun/contracts'
import * as Notifications from 'expo-notifications'
import { AndroidImportance } from 'expo-notifications'
import { Platform } from 'react-native'

import appJson from '../../app.json'
import { brand } from '@/theme/tokens'

import { askForPushOnce, pushAvailable, registerDevice, setConversationOnScreen, turnOnPush, unregisterDevice } from './push'
import { PushRouting } from './PushRouting'

const mockApi = jest.fn().mockResolvedValue(undefined)
jest.mock('@/api/client', () => ({ api: (...args: unknown[]) => mockApi(...args), appBuild: 7 }))
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0' }))
const RERUN_CLOUD_CONFIG = { extra: { eas: { projectId: 'project-1' } }, android: { googleServicesFile: './google-services.json' } }
// Read through a global: push.ts reads the config while the test file is still importing it.
const testGlobal = globalThis as { mockExpoConfig?: object }
jest.mock('expo-constants', () => ({
    get expoConfig() {
        return (globalThis as { mockExpoConfig?: object }).mockExpoConfig ?? { extra: { eas: { projectId: 'project-1' } }, android: { googleServicesFile: './google-services.json' } }
    },
}))
const mockDevice = { isDevice: true }
jest.mock('expo-device', () => ({ get isDevice() { return mockDevice.isDevice } }))
const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({ getItem: () => null, getItemAsync: async (key: string) => mockStore.get(key) ?? null, setItemAsync: async (key: string, value: string) => void mockStore.set(key, value) }))

const mockPermissions = { status: 'granted' }
const mockCalls: string[] = []
const mockRequestPermissions = jest.fn(async () => {
    mockCalls.push('requestPermissions')
    return mockPermissions
})
const mockSetChannel = jest.fn(async (id: string, _channel: unknown) => {
    mockCalls.push(`channel:${id}`)
    return null
})
const mockPushToken = jest.fn(async () => ({ data: 'ExponentPushToken[abc]' }))
let mockLastResponse: unknown = null
jest.mock('expo-notifications', () => ({
    AndroidImportance: { LOW: 4, DEFAULT: 5, HIGH: 6 },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: (id: string, channel: unknown) => mockSetChannel(id, channel),
    getPermissionsAsync: async () => mockPermissions,
    requestPermissionsAsync: () => mockRequestPermissions(),
    getExpoPushTokenAsync: () => mockPushToken(),
    setBadgeCountAsync: jest.fn(),
    useLastNotificationResponse: () => mockLastResponse,
}))
const mockPush = jest.fn()
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }))


const caller = { accessToken: 'jwt', workspaceId: 7 }
const notification = (data: object, identifier = 'n1') => ({ request: { identifier, content: { data } } }) as unknown as Notifications.Notification

describe('push registration', () => {
    beforeEach(() => {
        mockApi.mockClear()
        mockRequestPermissions.mockClear()
        mockSetChannel.mockClear()
        mockPushToken.mockClear()
        mockCalls.length = 0
        mockStore.clear()
        mockDevice.isDevice = true
        mockPermissions.status = 'granted'
    })

    it('registers the token of an allowed phone, and nothing from a simulator', async () => {
        await registerDevice(caller)
        expect(mockApi).toHaveBeenCalledWith('/api/v1/me/devices', { ...caller, method: 'POST', body: { token: 'ExponentPushToken[abc]', platform: Platform.OS, appVersion: '1.0.0 (7)' } })
        mockApi.mockClear()
        mockDevice.isDevice = false
        await registerDevice(caller)
        expect(mockApi).not.toHaveBeenCalled()
    })

    it('asks for permission once, ever', async () => {
        await askForPushOnce(caller)
        await askForPushOnce(caller)
        expect(mockRequestPermissions).toHaveBeenCalledTimes(1)
    })

    it('registers at launch where the permission comes with the install (Android before 13), without asking', async () => {
        await registerDevice(caller)
        expect(mockRequestPermissions).not.toHaveBeenCalled()
        expect(mockApi).toHaveBeenCalledWith('/api/v1/me/devices', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ platform: Platform.OS }) }))
    })

    it('creates the Android channels before it asks (Android 13 shows no prompt without one), and none on iOS', async () => {
        mockPermissions.status = 'undetermined'
        mockRequestPermissions.mockImplementationOnce(async () => {
            mockCalls.push('requestPermissions')
            mockPermissions.status = 'granted'
            return mockPermissions
        })
        await askForPushOnce(caller)
        if (Platform.OS === 'android') {
            expect(mockCalls.indexOf('requestPermissions')).toBeGreaterThan(mockCalls.indexOf(`channel:${ANDROID_PUSH_CHANNELS.silent}`))
            expect(mockCalls.indexOf('requestPermissions')).toBeGreaterThan(mockCalls.indexOf(`channel:${ANDROID_PUSH_CHANNELS.messages}`))
            expect(mockSetChannel).toHaveBeenCalledWith(ANDROID_PUSH_CHANNELS.messages, expect.objectContaining({ name: 'Coworker messages', importance: AndroidImportance.HIGH, sound: 'default' }))
            expect(mockSetChannel).toHaveBeenCalledWith(ANDROID_PUSH_CHANNELS.silent, expect.objectContaining({ name: 'Finished tasks', importance: AndroidImportance.LOW, sound: null }))
        } else {
            expect(mockSetChannel).not.toHaveBeenCalled()
        }
        expect(mockApi).toHaveBeenCalledTimes(1)
    })

    it('registers nothing when the person says no', async () => {
        mockPermissions.status = 'denied'
        expect(await turnOnPush(caller)).toBe('denied')
        expect(mockPushToken).not.toHaveBeenCalled()
        expect(mockApi).not.toHaveBeenCalled()
    })

    it('stays quiet when the phone has no token to give, as an Android phone without Play Services', async () => {
        mockPushToken.mockRejectedValueOnce(new Error('Default FirebaseApp is not initialized in this process'))
        await expect(registerDevice(caller)).resolves.toBeUndefined()
        expect(mockApi).not.toHaveBeenCalled()
    })

    it('drops the token on sign-out', async () => {
        await registerDevice(caller)
        await unregisterDevice(caller)
        expect(mockApi).toHaveBeenLastCalledWith('/api/v1/me/devices', { ...caller, method: 'DELETE', body: { token: 'ExponentPushToken[abc]', platform: Platform.OS } })
    })
})

describe('push display and taps', () => {
    it('keeps quiet about the conversation on screen, and shows the others', async () => {
        const mockHandler = jest.mocked(Notifications.setNotificationHandler).mock.calls[0][0]
        setConversationOnScreen('conv-1')
        expect(await mockHandler!.handleNotification(notification({ agentId: 'a1', conversationId: 'conv-1', kind: 'question' }))).toMatchObject({ shouldShowBanner: false })
        expect(await mockHandler!.handleNotification(notification({ agentId: 'a1', conversationId: 'conv-2', kind: 'question' }))).toMatchObject({ shouldShowBanner: true })
        setConversationOnScreen(null)
    })

    it('opens the conversation a tapped push is about, once', async () => {
        mockLastResponse = { notification: notification({ agentId: 'a1', conversationId: 'conv-2', kind: 'question' }, 'n9') }
        const view = await render(<PushRouting />)
        await view.rerender(<PushRouting />)
        expect(mockPush).toHaveBeenCalledTimes(1)
        expect(mockPush).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'conv-2', to: 'a1' } })
    })

    it('opens a push from the Foreman on its own chat page', async () => {
        mockPush.mockClear()
        mockLastResponse = { notification: notification({ agentId: FOREMAN_AGENT_ID, conversationId: 'conv-3', kind: 'question' }, 'n10') }
        await render(<PushRouting />)
        expect(mockPush).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'conv-3' } })
    })
})

describe('push availability', () => {
    it('is offered where a token can be had', () => {
        expect(pushAvailable).toBe(true)
    })

    it('is not offered on an Android build made without Firebase, nor in a build without an EAS project', () => {
        const pushAvailableWith = (expoConfig: object) => {
            testGlobal.mockExpoConfig = expoConfig
            let available: boolean | undefined
            jest.isolateModules(() => {
                available = require('./push').pushAvailable
            })
            testGlobal.mockExpoConfig = undefined
            return available
        }
        expect(pushAvailableWith({ extra: RERUN_CLOUD_CONFIG.extra })).toBe(Platform.OS !== 'android')
        expect(pushAvailableWith({ android: RERUN_CLOUD_CONFIG.android })).toBe(false)
    })

    it('rings Android pushes on the default channel, with the brand color', () => {
        const plugin = appJson.expo.plugins.find(entry => Array.isArray(entry) && entry[0] === 'expo-notifications') as [string, { color: string; defaultChannel: string; icon: string }]
        expect(plugin[1]).toMatchObject({ color: brand.base, defaultChannel: ANDROID_PUSH_CHANNELS.messages, icon: './assets/images/notification-icon.png' })
    })
})
