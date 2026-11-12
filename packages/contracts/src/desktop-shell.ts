// The contract between the Rerun desktop app (`apps/desktop-app`, an Electron shell that loads the web
// app) and the web app it loads. The web is deployed continuously while old shells stay installed for
// months, so the web never assumes a method exists: it checks `apiVersion` and the capability first.

// Bumped only when a method changes shape. A new method is a new capability, not a new version.
export const DESKTOP_SHELL_API_VERSION = 1

export const DESKTOP_SHELL_PLATFORMS = ['mac', 'win', 'linux'] as const
export type DesktopShellPlatform = (typeof DESKTOP_SHELL_PLATFORMS)[number]

export const DESKTOP_SHELL_CHANNELS = ['stable', 'staging', 'dev'] as const
export type DesktopShellChannel = (typeof DESKTOP_SHELL_CHANNELS)[number]

export const DESKTOP_SHELL_CAPABILITIES = ['window', 'find', 'links', 'update', 'auth', 'downloads'] as const
export type DesktopShellCapability = (typeof DESKTOP_SHELL_CAPABILITIES)[number]

// Appended to the browser's User-Agent by the shell: `RerunDesktop/0.1.0 (mac; stable)`. The server
// reads it to render the desktop chrome from the first paint, before any script runs.
export const DESKTOP_SHELL_UA_TOKEN = 'RerunDesktop'

// Set on <html> by the server when the request comes from the shell, valued with the platform.
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

// Plain semver compare on `major.minor.patch`, a prerelease sorting before its release.
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

export type DesktopSignInProvider = 'google' | 'apple'

export type DesktopSignInResult = { status: 'signed-in' } | { status: 'error'; reason: DesktopSignInError }

export type DesktopSignInError = 'expired' | 'invalid' | 'state-mismatch' | 'network' | 'cancelled'

type Unsubscribe = () => void

// What `window.rerunShell` holds inside the shell, and only for the configured server's origin.
export type DesktopShellApi = {
    apiVersion: number
    version: string
    platform: DesktopShellPlatform
    channel: DesktopShellChannel
    capabilities: readonly DesktopShellCapability[]
    window: {
        getState(): Promise<DesktopWindowState>
        onState(callback: (state: DesktopWindowState) => void): Unsubscribe
        // Windows and Linux draw their caption buttons over the page: the page tells them its colors.
        setChrome(chrome: { frameColor: string; symbolColor: string }): void
    }
    find: {
        open(): void
    }
    links: {
        // Opens an https or mailto URL in the system browser.
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
}

// What `GET /api/desktop/config` answers, public: proof the server is a Rerun hub, and the oldest
// shell it still serves. A shell under `minShellVersion` must update before it loads the app.
export type DesktopServerConfig = {
    app: 'rerun'
    apiVersion: number
    minShellVersion: string
}

// The desktop sign-in hand-off: the browser signs in on the web, the server mints a one-time code
// bound to the shell's PKCE challenge and hands it back through the shell's URL scheme.
export const DESKTOP_AUTH_CODE_TTL_SECONDS = 120
export const DESKTOP_AUTH_PATH = '/auth/desktop'
export const DESKTOP_AUTH_CALLBACK_HOST = 'auth'
export const DESKTOP_AUTH_CALLBACK_PATH = '/callback'

// `rerun-desktop`, `rerun-desktop-staging`, `rerun-desktop-dev`: one URL scheme per channel, so a
// staging build never answers a production link. `rerun://` belongs to the mobile app.
export function desktopShellScheme(channel: DesktopShellChannel): string {
    return channel === 'stable' ? 'rerun-desktop' : `rerun-desktop-${channel}`
}

export function isDesktopShellChannel(value: unknown): value is DesktopShellChannel {
    return typeof value === 'string' && (DESKTOP_SHELL_CHANNELS as readonly string[]).includes(value)
}
