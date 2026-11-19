import { siteOf } from '@rerun/contracts'
import { Linking } from 'react-native'

import { openInAppBrowser, type LinkOrigin } from '@/lib/in-app-browser'
import { loadLinkTarget } from '@/lib/link-target'

export const hostOf = (url: string | null | undefined): string | null => (url ? siteOf(url) : null)

export const faviconUrl = (domain: string): string => `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`

export const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url)

// A link an agent wrote opens only when it is a web page: any other scheme stays shut. It opens in the
// phone's own browser, where the person is already signed in to their services, unless the
// Preferences keep links in Rerun's browser; `from`, the message it was read in, stays under the
// page there. Resolves to whether something opened.
export async function openExternalUrl(url: string, from?: LinkOrigin): Promise<boolean> {
    if (!isWebUrl(url)) return false
    if ((await loadLinkTarget()) === 'app') {
        openInAppBrowser({ url, from })
        return true
    }
    return openInPhoneBrowser(url)
}

// Rerun's own web app, whatever the Preferences: Rerun's browser shares no session with it, and Google
// refuses to sign in inside an embedded web view.
export async function openInPhoneBrowser(url: string): Promise<boolean> {
    if (!isWebUrl(url)) return false
    return Linking.openURL(url).then(
        () => true,
        () => false
    )
}
