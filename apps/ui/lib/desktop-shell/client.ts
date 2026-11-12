import { DESKTOP_SHELL_API_VERSION, type DesktopShellApi, type DesktopShellCapability } from '@rerun/contracts'

declare global {
    interface Window {
        // Set by the desktop app (apps/desktop-app) on the pages of the server it shows, and only there.
        rerunShell?: DesktopShellApi
    }
}

// The only place the web app reads `window.rerunShell`. An old app stays installed for months while
// the web ships every day, so a caller names the capability it needs and gets null when the app it
// runs in does not have it.
export function desktopShell(capability?: DesktopShellCapability): DesktopShellApi | null {
    if (typeof window === 'undefined') return null
    const shell = window.rerunShell
    if (!shell || shell.apiVersion !== DESKTOP_SHELL_API_VERSION) return null
    if (capability && !shell.capabilities.includes(capability)) return null
    return shell
}

export function isDesktopShell(): boolean {
    return desktopShell() !== null
}
