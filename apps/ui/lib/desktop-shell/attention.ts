import type { DesktopWindowState } from '@rerun/contracts'
import { desktopShell } from './client'

export type PageAttention = 'focused' | 'visible' | 'hidden'

// Whether someone is looking at the app. In a browser that is the tab's visibility. In the desktop
// app the window keeps its timers when hidden (so its realtime channel stays up), which leaves
// `document.visibilityState` stuck on visible: the window's own state answers instead.
let windowState: DesktopWindowState | null = null
let watching = false
const listeners = new Set<() => void>()

function notify(): void {
    for (const listener of [...listeners]) listener()
}

function watchWindow(): void {
    const shell = desktopShell('window')
    if (watching || !shell) return
    watching = true
    void shell.window.getState().then((state) => {
        if (!state) return
        windowState = state
        notify()
    })
    shell.window.onState((state) => {
        windowState = state
        notify()
    })
}

// `focused`: the person is in the app. `visible`: it is on screen behind another one. `hidden`: closed
// into the tray, minimized, or a background tab.
export function pageAttention(): PageAttention {
    if (typeof document === 'undefined') return 'hidden'
    watchWindow()
    if (windowState) {
        if (!windowState.visible) return 'hidden'
        return windowState.focused ? 'focused' : 'visible'
    }
    if (document.visibilityState !== 'visible') return 'hidden'
    return document.hasFocus() ? 'focused' : 'visible'
}

// Called on every change of `pageAttention()`, for `useSyncExternalStore`.
export function subscribePageAttention(listener: () => void): () => void {
    watchWindow()
    if (listeners.size === 0) {
        document.addEventListener('visibilitychange', notify)
        window.addEventListener('focus', notify)
        window.addEventListener('blur', notify)
    }
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
        if (listeners.size > 0) return
        document.removeEventListener('visibilitychange', notify)
        window.removeEventListener('focus', notify)
        window.removeEventListener('blur', notify)
    }
}

// Called only when the page goes from hidden to shown or back, not when the focus moves to another
// app while it stays on screen: what a poll or a presence beacon cares about.
export function onPageShownOrHidden(listener: (shown: boolean) => void): () => void {
    let shown = pageAttention() !== 'hidden'
    return subscribePageAttention(() => {
        const now = pageAttention() !== 'hidden'
        if (now === shown) return
        shown = now
        listener(now)
    })
}
