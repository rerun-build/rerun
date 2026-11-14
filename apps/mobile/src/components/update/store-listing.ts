import { Linking } from 'react-native'

import { clientPlatform } from '@/lib/client-platform'

const APP_STORE_URL = 'https://apps.apple.com/app/id6825274993'
const PLAY_STORE_APP_URL = 'market://details?id=build.rerun.app'
const PLAY_STORE_WEB_URL = 'https://play.google.com/store/apps/details?id=build.rerun.app'

export async function openStoreListing(): Promise<void> {
    if (clientPlatform === 'ios') return Linking.openURL(APP_STORE_URL)
    try {
        await Linking.openURL(PLAY_STORE_APP_URL)
    } catch {
        await Linking.openURL(PLAY_STORE_WEB_URL)
    }
}
