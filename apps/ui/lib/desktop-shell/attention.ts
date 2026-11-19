import type { DesktopWindowState } from '@moldwright/contracts'
import { desktopShell } from './client'

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
