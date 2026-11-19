import type { AddableProvider } from '@moldwright/contracts'
import { router, type Href } from 'expo-router'

export function connectHref(provider: AddableProvider, reconnectId?: string): Href {
    return { pathname: '/providers/connect/[provider]', params: reconnectId ? { provider, reconnect: reconnectId } : { provider } }
}

export function leave() {
    if (router.canGoBack()) router.back()
    else router.replace('/')
}

export function signsIn(provider: string): boolean {
    return provider === 'claude' || provider === 'codex'
}
