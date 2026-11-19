import { router } from 'expo-router'

export type LinkAuthor = { id: string; kind: 'coworker' | 'foreman'; name: string; role: string }

// The message a link was read in, kept under the page in Rerun's browser.
export type LinkOrigin = { author: LinkAuthor; excerpt: string }

// Handed over in memory by the screen that opens it: left to a route parameter, any link the phone
// opens could show a page of its choosing inside the app's frame.
export type BrowserOpen = { url: string; from?: LinkOrigin }

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
