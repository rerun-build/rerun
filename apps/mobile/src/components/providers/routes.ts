import type { AddableProvider } from '@rerun/contracts'
import { router, type Href } from 'expo-router'

// `reconnect` signs an existing connection in again instead of adding one.
export function connectHref(provider: AddableProvider, reconnectId?: string): Href {
    return { pathname: '/providers/connect/[provider]', params: reconnectId ? { provider, reconnect: reconnectId } : { provider } }
}

// A screen reached by a link has nothing under it to go back to.
export function leave() {
    if (router.canGoBack()) router.back()
    else router.replace('/')
}

// OpenCode is sold as a plan but connected with a key: only Claude, ChatGPT and Grok sign in again,
// every other provider gets a new key pasted over the one turned away.
export function signsIn(provider: string): boolean {
    return provider === 'claude' || provider === 'codex' || provider === 'grok'
}
