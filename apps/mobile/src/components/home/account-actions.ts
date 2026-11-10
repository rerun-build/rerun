import type { Me } from '@rerun/contracts'
import * as WebBrowser from 'expo-web-browser'
import { Alert } from 'react-native'

import { deleteAccount, fetchDeletionBlockers } from '@/api/account'
import { ApiError } from '@/api/client'
import { translatorFor } from '@/i18n/translator'
import { switchServer } from '@/config/custom-server'
import { webHost } from '@/config/environment'

// The web opens the same Crisp chat; the app has no widget of its own, so it opens the chat page.
const CRISP_WEBSITE_ID = 'fa9be3a1-b3f1-4813-840f-d6e235a05179'

export function initialsOf(user: Me['user'] | undefined): string | null {
    const words = user?.name?.trim().split(/\s+/).filter(Boolean) ?? []
    if (words.length) return words.slice(0, 2).map(word => word[0].toUpperCase()).join('')
    return user?.email?.[0]?.toUpperCase() ?? null
}

export function contactSupport(user: Me['user'] | undefined) {
    const email = user?.email && !user.email.endsWith('@phone.rerun.build') ? `&user_email=${encodeURIComponent(user.email)}` : ''
    return WebBrowser.openBrowserAsync(`https://go.crisp.chat/chat/embed/?website_id=${CRISP_WEBSITE_ID}${email}`)
}

const confirm = (title: string, message: string, action: string, cancel: string) =>
    new Promise<boolean>(resolve =>
        Alert.alert(title, message, [
            { text: cancel, style: 'cancel', onPress: () => resolve(false) },
            { text: action, style: 'destructive', onPress: () => resolve(true) },
        ])
    )

export async function askToLeaveServer(signOut: () => Promise<void>) {
    const t = translatorFor('mobileHome')
    const confirmed = await confirm(t('account.leaveServerTitle', { host: webHost }), t('account.leaveServerMessage'), t('account.leaveServer'), t('account.cancel'))
    if (!confirmed) return
    await signOut()
    await switchServer(null)
}

// Same rule as the web: a workspace only this account holds and that still bills stops the deletion,
// and is named so it can be cancelled first.
export async function askToDeleteAccount(accessToken: string, signOut: () => Promise<void>) {
    const t = translatorFor('mobileHome')
    try {
        const blockers = await fetchDeletionBlockers({ accessToken })
        if (blockers.length) {
            Alert.alert(t('account.subscriptionTitle'), t('account.subscriptionMessage', { workspaces: blockers.map(blocker => blocker.name).join(', ') }))
            return
        }
        const confirmed = await confirm(t('account.deleteTitle'), t('account.deleteMessage'), t('account.delete'), t('account.cancel'))
        if (!confirmed) return
        await deleteAccount({ accessToken })
        await signOut()
    } catch (error) {
        // The hub wants a sign-in from the last minutes behind an irreversible step: the person signs
        // in again and asks once more.
        if (error instanceof ApiError && error.status === 403) {
            Alert.alert(t('account.reauthTitle'), t('account.reauthMessage'), [{ text: t('account.signOut'), onPress: () => void signOut() }, { text: t('account.cancel'), style: 'cancel' }])
            return
        }
        Alert.alert(t('account.deleteFailedTitle'), t('account.deleteFailedMessage'))
    }
}
