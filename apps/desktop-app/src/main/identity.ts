import { app } from 'electron'
import { CHANNEL_IDENTITIES } from '../shared/channels'
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

export const PRODUCT_NAME = CHANNEL_IDENTITIES[CHANNEL].productName

export const APP_ID = CHANNEL_IDENTITIES[CHANNEL].appId

export const BASE_CAPABILITIES: readonly DesktopShellCapability[] = ['window', 'find', 'links', 'downloads', 'auth', 'oauth', 'notifications', 'badge', 'settings', 'locale', 'quickAsk', 'server']

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

export function shellUserAgent(defaultUserAgent: string): string {
    const chrome = defaultUserAgent
        .replace(/ RerunDesktop\/\S+ \([^)]*\)/g, '')
        .replace(/ Electron\/\S+/, '')
        .replace(/\(KHTML, like Gecko\) (?:\S+\/\S+ )+Chrome\//, '(KHTML, like Gecko) Chrome/')
    return `${chrome} ${desktopShellUserAgentToken(shellIdentity())}`
}

export function devToolsAllowed(): boolean {
    return CHANNEL !== 'stable' || !app.isPackaged
}
