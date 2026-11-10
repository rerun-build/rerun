import { ANDROID_PUSH_CHANNELS, pushDataSchema, type PushData } from '@rerun/contracts'
import * as Application from 'expo-application'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { AndroidImportance } from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import { api, appBuild } from '@/api/client'
import { onCustomServer } from '@/config/environment'
import { translatorFor } from '@/i18n/translator'
import { clientPlatform } from '@/lib/client-platform'

type Caller = { accessToken: string; workspaceId: number }

const ASKED_KEY = 'rerun.push-asked'

const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId

// An Android token comes from Firebase, which a build without google-services.json does not have.
const tokenProviderConfigured = Platform.OS !== 'android' || Boolean(Constants.expoConfig?.android?.googleServicesFile)

// Pushes go out through Rerun's Expo project, which only Rerun Cloud sends with: on a server of the
// person's own, or in a build with no project to get a token from, the app never asks for them.
export const pushAvailable = !onCustomServer && Boolean(projectId) && tokenProviderConfigured

let registeredToken: string | null = null

// The conversation on screen: a push about it is not shown while the person is reading it.
let conversationOnScreen: string | null = null

export function setConversationOnScreen(id: string | null) {
    conversationOnScreen = id
}

export function pushDataOf(notification: Notifications.Notification): PushData | null {
    const parsed = pushDataSchema.safeParse(notification.request.content.data)
    return parsed.success ? parsed.data : null
}

Notifications.setNotificationHandler({
    handleNotification: async notification => {
        const id = pushDataOf(notification)?.conversationId
        const visible = !(id && id === conversationOnScreen)
        return { shouldShowBanner: visible, shouldShowList: visible, shouldPlaySound: visible, shouldSetBadge: false }
    },
})

// Android 13 only shows its permission prompt once a channel exists, and a push naming a channel the
// phone does not know is dropped. Set again on every launch: it renames them in the current language.
async function createAndroidChannels(): Promise<void> {
    if (Platform.OS !== 'android') return
    const t = translatorFor('mobileSettings')
    await Promise.all([
        Notifications.setNotificationChannelAsync(ANDROID_PUSH_CHANNELS.messages, {
            name: t('notifications.channels.messages.name'),
            description: t('notifications.channels.messages.description'),
            importance: AndroidImportance.HIGH,
            sound: 'default',
        }),
        Notifications.setNotificationChannelAsync(ANDROID_PUSH_CHANNELS.silent, {
            name: t('notifications.channels.silent.name'),
            description: t('notifications.channels.silent.description'),
            importance: AndroidImportance.LOW,
            sound: null,
            enableVibrate: false,
        }),
    ])
}

// Expo answers with no token when the phone cannot reach Firebase (no Play Services) or a build was
// made without it: push is then off for this phone, quietly, as where it is not offered at all.
async function expoPushToken(): Promise<string | null> {
    try {
        return (await Notifications.getExpoPushTokenAsync({ projectId })).data
    } catch {
        return null
    }
}

// Registered on every launch once allowed: Expo can rotate the token, and the hub keeps the last
// time it was seen. A simulator has no token to give.
export async function registerDevice(caller: Caller): Promise<void> {
    if (!pushAvailable || !Device.isDevice) return
    await createAndroidChannels()
    const { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') return
    const token = await expoPushToken()
    if (!token) return
    await api('/api/v1/me/devices', { ...caller, method: 'POST', body: { token, platform: clientPlatform, appVersion: `${Application.nativeApplicationVersion ?? '0.0.0'} (${appBuild})` } })
    registeredToken = token
}

// Asked once, after the first message the person sends: by then a coworker has something to say back.
export async function askForPushOnce(caller: Caller): Promise<void> {
    if (!pushAvailable) return
    if (await SecureStore.getItemAsync(ASKED_KEY)) return
    await SecureStore.setItemAsync(ASKED_KEY, '1')
    await createAndroidChannels()
    const { status } = await Notifications.requestPermissionsAsync()
    if (status === 'granted') await registerDevice(caller)
}

export async function pushPermission(): Promise<Notifications.PermissionStatus> {
    return (await Notifications.getPermissionsAsync()).status
}

export async function turnOnPush(caller: Caller): Promise<Notifications.PermissionStatus> {
    await SecureStore.setItemAsync(ASKED_KEY, '1')
    await createAndroidChannels()
    const { status } = await Notifications.requestPermissionsAsync()
    if (status === 'granted') await registerDevice(caller)
    return status
}

// Signing out stops this phone ringing for that account.
export async function unregisterDevice(caller: Caller): Promise<void> {
    if (!registeredToken) return
    await api('/api/v1/me/devices', { ...caller, method: 'DELETE', body: { token: registeredToken, platform: clientPlatform } })
    registeredToken = null
}

// Android leaves the badge to the launcher: some show the count, some a dot, some nothing.
export async function setBadge(count: number): Promise<void> {
    await Notifications.setBadgeCountAsync(count)
}
