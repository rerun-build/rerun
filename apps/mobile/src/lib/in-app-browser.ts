import { router } from 'expo-router'

// The page Rerun's own browser opens, and the message the link was read in, handed over in memory by
// the screen that opens it: left to a route parameter, any link the phone opens could show a page of
// its choosing inside the app's frame.
export type BrowserOpen = { url: string; excerpt?: string }

let pending: BrowserOpen | null = null

export function takePendingBrowserOpen(): BrowserOpen | null {
    const open = pending
    pending = null
    return open
}

export function openInAppBrowser(open: BrowserOpen) {
    pending = open
    router.push('/browser')
}
