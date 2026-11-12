import { desktopServiceSignInAvailable } from '@/lib/desktop-shell/service-sign-in'

const WIDTH = 500
const HEIGHT = 640

// A popup opened after the install and start round-trips is too far from the click and gets
// blocked. So the window opens empty inside the click handler, and is pointed at the
// authorization URL once it is known. `label` is what the empty window shows meanwhile, already in
// the viewer's language; a caller with no translator gets the English one.
export function openPendingSignInPopup(name: string, label = `Connecting to ${name}…`): Window | null {
    // The desktop app runs the sign-in in the system browser: no window to open here.
    if (desktopServiceSignInAvailable()) return null
    const left = window.screenX + (window.outerWidth - WIDTH) / 2
    const top = window.screenY + (window.outerHeight - HEIGHT) / 2
    const popup = window.open('about:blank', 'rerun-sign-in', `width=${WIDTH},height=${HEIGHT},left=${left},top=${top},popup=yes`)
    if (!popup) return null
    // A window of that name left on a provider's page by an abandoned sign-in is still
    // cross-origin here: decorating it throws, redirecting it later works.
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
