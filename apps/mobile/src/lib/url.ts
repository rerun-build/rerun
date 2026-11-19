import { siteOf } from '@rerun/contracts'
import { Linking } from 'react-native'

export const hostOf = (url: string | null | undefined): string | null => (url ? siteOf(url) : null)

export const faviconUrl = (domain: string): string => `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`

export const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url)

// A link an agent wrote opens only when it is a web page: any other scheme stays shut. It opens in the
// phone's own browser, where the person is already signed in to their services. Resolves to whether
// something opened.
export async function openExternalUrl(url: string): Promise<boolean> {
    return openInPhoneBrowser(url)
}

// Rerun's own web app always goes to the phone's browser, where the person is signed in to it.
export async function openInPhoneBrowser(url: string): Promise<boolean> {
    if (!isWebUrl(url)) return false
    return Linking.openURL(url).then(
        () => true,
        () => false
    )
}
