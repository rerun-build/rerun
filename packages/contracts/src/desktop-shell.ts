export const DESKTOP_SHELL_API_VERSION = 1

export const DESKTOP_SHELL_PLATFORMS = ['mac', 'win', 'linux'] as const
export type DesktopShellPlatform = (typeof DESKTOP_SHELL_PLATFORMS)[number]

export const DESKTOP_SHELL_CHANNELS = ['stable', 'staging', 'dev'] as const
export type DesktopShellChannel = (typeof DESKTOP_SHELL_CHANNELS)[number]

export const DESKTOP_SHELL_CAPABILITIES = ['window', 'find', 'links', 'update', 'auth', 'downloads', 'oauth', 'notifications', 'badge', 'settings', 'locale', 'quickAsk', 'server'] as const
export type DesktopShellCapability = (typeof DESKTOP_SHELL_CAPABILITIES)[number]

export const DESKTOP_SHELL_UA_TOKEN = 'RerunDesktop'

export const DESKTOP_SHELL_ATTRIBUTE = 'data-desktop-shell'

export type DesktopShellIdentity = {
    version: string
    platform: DesktopShellPlatform
    channel: DesktopShellChannel
}

const UA_PATTERN = new RegExp(`${DESKTOP_SHELL_UA_TOKEN}/(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.]+)?) \\((mac|win|linux); (stable|staging|dev)\\)`)

export function desktopShellUserAgentToken(identity: DesktopShellIdentity): string {
    return `${DESKTOP_SHELL_UA_TOKEN}/${identity.version} (${identity.platform}; ${identity.channel})`
}

export function parseDesktopShellUserAgent(userAgent: string | null | undefined): DesktopShellIdentity | null {
    const match = userAgent?.match(UA_PATTERN)
    if (!match) return null
    return { version: match[1], platform: match[2] as DesktopShellPlatform, channel: match[3] as DesktopShellChannel }
}

export function compareShellVersions(a: string, b: string): number {
    const [coreA, preA] = a.split('-', 2)
    const [coreB, preB] = b.split('-', 2)
    const partsA = coreA.split('.').map(Number)
    const partsB = coreB.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
        const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0)
        if (diff !== 0) return Math.sign(diff)
    }
    if (preA === preB) return 0
    if (preA === undefined) return 1
    if (preB === undefined) return -1
    return preA < preB ? -1 : 1
}

export type DesktopWindowState = {
    focused: boolean
    visible: boolean
    fullscreen: boolean
    maximized: boolean
}

export type DesktopUpdateState =
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'downloading'; version: string; percent: number }
    | { status: 'ready'; version: string }
    | { status: 'error'; message: string }

export type DesktopDownloadEvent = {
    id: string
    filename: string
    state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
    receivedBytes: number
    totalBytes: number
}

export type DesktopOAuthReturn = { status: 'success'; claim?: string } | { status: 'error'; message: string }

export const DESKTOP_OAUTH_RETURN_HOST = 'oauth'

export const DESKTOP_OPEN_HOST = 'open'

export const DESKTOP_APP_COOKIE = 'rr_desktop_app'

export function isDesktopOpenPath(path: string): boolean {
    return path.length <= 2000 && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') && /^[\x21-\x7e]+$/.test(path)
}

export type DesktopNotification = { id: string; title: string; body?: string; silent?: boolean }

export type DesktopSettings = {
    openAtLogin: boolean
    closeToTray: boolean
    quickAsk: boolean
}

export const QUICK_ASK_PATH = '/quick-ask'

export const QUICK_ASK_SHORTCUT = 'CommandOrControl+Shift+Space'

export type DesktopSignInProvider = 'google' | 'apple'

export type DesktopSignInResult = { status: 'signed-in' } | { status: 'error'; reason: DesktopSignInError }

export type DesktopSignInError = 'expired' | 'invalid' | 'state-mismatch' | 'network' | 'cancelled'

type Unsubscribe = () => void

export type DesktopShellApi = {
    apiVersion: number
    version: string
    platform: DesktopShellPlatform
    channel: DesktopShellChannel
    capabilities: readonly DesktopShellCapability[]
    window: {
        getState(): Promise<DesktopWindowState>
        onState(callback: (state: DesktopWindowState) => void): Unsubscribe
        setChrome(chrome: { frameColor: string; symbolColor: string }): void
    }
    find: {
        open(): void
    }
    links: {
        openExternal(url: string): Promise<boolean>
    }
    update: {
        getState(): Promise<DesktopUpdateState>
        onState(callback: (state: DesktopUpdateState) => void): Unsubscribe
        check(): void
        install(): void
    }
    auth: {
        startBrowserSignIn(options?: { provider?: DesktopSignInProvider }): Promise<void>
        submitCode(code: string): Promise<DesktopSignInResult>
        onResult(callback: (result: DesktopSignInResult) => void): Unsubscribe
    }
    downloads: {
        onEvent(callback: (event: DesktopDownloadEvent) => void): Unsubscribe
        show(id: string): void
    }
    oauth: {
        onReturn(callback: (result: DesktopOAuthReturn) => void): Unsubscribe
    }
    notifications: {
        show(notification: DesktopNotification): Promise<boolean>
        onClick(callback: (id: string) => void): Unsubscribe
    }
    badge: {
        set(count: number): void
    }
    settings: {
        get(): Promise<DesktopSettings>
        set(patch: Partial<DesktopSettings>): Promise<DesktopSettings>
    }
    locale: {
        set(locale: string): void
    }
    server: {
        openPicker(): void
    }
    quickAsk: {
        shortcut: string
        close(): void
        sent(path: string): void
    }
}

export type DesktopServerConfig = {
    app: 'rerun'
    apiVersion: number
    minShellVersion: string
}

export const DESKTOP_AUTH_CODE_TTL_SECONDS = 120
export const DESKTOP_AUTH_PATH = '/auth/desktop'
export const DESKTOP_AUTH_CALLBACK_HOST = 'auth'
export const DESKTOP_AUTH_CALLBACK_PATH = '/callback'

export function desktopShellScheme(channel: DesktopShellChannel): string {
    return channel === 'stable' ? 'rerun-desktop' : `rerun-desktop-${channel}`
}

export function isDesktopShellChannel(value: unknown): value is DesktopShellChannel {
    return typeof value === 'string' && (DESKTOP_SHELL_CHANNELS as readonly string[]).includes(value)
}
