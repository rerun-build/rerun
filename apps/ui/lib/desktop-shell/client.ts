import { DESKTOP_SHELL_API_VERSION, type DesktopShellApi, type DesktopShellCapability } from '@moldwright/contracts'

declare global {
    interface Window {
        rerunShell?: DesktopShellApi
    }
}

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
