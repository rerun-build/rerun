import type { DesktopWindowState } from '@rerun/contracts'
import { desktopShell } from './client'

// Whether someone is looking at the app. In a browser that is the tab's visibility. In the desktop
// app the window keeps its timers when hidden (so its realtime channel stays up), which leaves
// `document.visibilityState` stuck on visible: the window's own state answers instead.
let windowState: DesktopWindowState | null = null
let watching = false

function watchWindow(): void {
    const shell = desktopShell('window')
    if (watching || !shell) return
    watching = true
    void shell.window.getState().then((state) => {
        if (state) windowState = state
    })
    shell.window.onState((state) => {
        windowState = state
    })
}

// `focused`: the person is in the app. `visible`: it is on screen behind another one. `hidden`: closed
// into the tray, minimized, or a background tab.
export function pageAttention(): 'focused' | 'visible' | 'hidden' {
    if (typeof document === 'undefined') return 'hidden'
    watchWindow()
    if (windowState) {
        if (!windowState.visible) return 'hidden'
        return windowState.focused ? 'focused' : 'visible'
    }
    if (document.visibilityState !== 'visible') return 'hidden'
    return document.hasFocus() ? 'focused' : 'visible'
}
