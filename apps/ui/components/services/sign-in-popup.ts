import { desktopServiceSignInAvailable } from '@/lib/desktop-shell/service-sign-in'

const WIDTH = 500
const HEIGHT = 640

export function openPendingSignInPopup(name: string, label = `Connecting to ${name}…`): Window | null {
    if (desktopServiceSignInAvailable()) return null
    const left = window.screenX + (window.outerWidth - WIDTH) / 2
    const top = window.screenY + (window.outerHeight - HEIGHT) / 2
    const popup = window.open('about:blank', 'rerun-sign-in', `width=${WIDTH},height=${HEIGHT},left=${left},top=${top},popup=yes`)
    if (!popup) return null
    try {
        popup.document.title = label
        popup.document.body.style.cssText = 'margin:0;height:100vh;display:grid;place-items:center;font:14px system-ui,sans-serif;color:#888;background:#0a0a0a'
        popup.document.body.textContent = label
    } catch {}
    return popup
}

export function redirectPendingSignInPopup(pending: Window | null | undefined, url: string): Window | null {
    if (!pending || pending.closed) return null
    pending.location.href = url
    return pending
}
