import { app } from 'electron'
import {
    DESKTOP_SHELL_API_VERSION,
    desktopShellScheme,
    desktopShellUserAgentToken,
    type DesktopShellCapability,
    type DesktopShellIdentity,
    type DesktopShellPlatform,
} from '@rerun/contracts'

export const CHANNEL = __RERUN_CHANNEL__

export const SCHEME = desktopShellScheme(CHANNEL)

export const PRODUCT_NAMES = { stable: 'Rerun', staging: 'Rerun Staging', dev: 'Rerun Dev' } as const

export const PRODUCT_NAME = PRODUCT_NAMES[CHANNEL]

export const BASE_CAPABILITIES: readonly DesktopShellCapability[] = ['window', 'find', 'links', 'downloads', 'auth', 'oauth']

export function shellPlatform(): DesktopShellPlatform {
    if (process.platform === 'darwin') return 'mac'
    if (process.platform === 'win32') return 'win'
    return 'linux'
}

export function shellIdentity(): DesktopShellIdentity {
    return { version: app.getVersion(), platform: shellPlatform(), channel: CHANNEL }
}

export function bootstrapPayload(extra: readonly DesktopShellCapability[]) {
    return { apiVersion: DESKTOP_SHELL_API_VERSION, ...shellIdentity(), capabilities: [...BASE_CAPABILITIES, ...extra] }
}

// Chrome's own User-Agent with the shell's token at the end. Electron's default also names the app
// and Electron: dropped, so sites the app opens in a child window (a sign-in popup, a captcha) see
// the Chrome they support, and the Rerun server sees the token it renders the desktop chrome for.
export function shellUserAgent(defaultUserAgent: string): string {
    const chrome = defaultUserAgent
        .replace(/ RerunDesktop\/\S+ \([^)]*\)/g, '')
        .replace(/ Electron\/\S+/, '')
        // Electron puts the app's own name and version between Gecko and Chrome.
        .replace(/\(KHTML, like Gecko\) (?:\S+\/\S+ )+Chrome\//, '(KHTML, like Gecko) Chrome/')
    return `${chrome} ${desktopShellUserAgentToken(shellIdentity())}`
}

// Developer tools are a menu item of the development and staging apps only.
export function devToolsAllowed(): boolean {
    return CHANNEL !== 'stable' || !app.isPackaged
}
