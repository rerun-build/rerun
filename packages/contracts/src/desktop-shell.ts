import type { QuickAskShortcutKind } from './desktop-shell-shortcut.js'

// The contract between the Rerun desktop app (`apps/desktop-app`, an Electron shell that loads the web
// app) and the web app it loads. The web is deployed continuously while old shells stay installed for
// months, so the web never assumes a method exists: it checks `apiVersion` and the capability first.

// Bumped only when a method changes shape. A new method is a new capability, not a new version.
export const DESKTOP_SHELL_API_VERSION = 1

export const DESKTOP_SHELL_PLATFORMS = ['mac', 'win', 'linux'] as const
export type DesktopShellPlatform = (typeof DESKTOP_SHELL_PLATFORMS)[number]

export const DESKTOP_SHELL_CHANNELS = ['stable', 'staging', 'dev'] as const
export type DesktopShellChannel = (typeof DESKTOP_SHELL_CHANNELS)[number]

export const DESKTOP_SHELL_CAPABILITIES = ['window', 'find', 'links', 'update', 'auth', 'downloads', 'oauth', 'notifications', 'badge', 'settings', 'locale', 'quickAsk', 'server', 'quickAskShortcut', 'quickAskVoice', 'quickAskVoiceShortcut', 'remoteComputer', 'coworkerDock', 'coworkerDockArrange', 'coworkerDockNotes'] as const
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

// A service sign-in (Gmail, an MCP server…) the page started in the system browser, as the
// browser hands it back to the app: `claim` names what the callback parked for the page to claim.
export type DesktopOAuthReturn = { status: 'success'; claim?: string } | { status: 'error'; message: string }

export const DESKTOP_OAUTH_RETURN_HOST = 'oauth'

// `rerun-desktop://open?path=/…`: a page of the server, opened in the app from a browser.
export const DESKTOP_OPEN_HOST = 'open'

// Set in a browser that signed a desktop app in, valued with its channel: that browser offers to open
// the pages of Rerun in the app. It says nothing else, and nothing a page could not already guess.
export const DESKTOP_APP_COOKIE = 'rr_desktop_app'

// A path of the server and nothing else: no scheme, no host, no protocol-relative `//`, printable.
export function isDesktopOpenPath(path: string): boolean {
    return path.length <= 2000 && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') && /^[\x21-\x7e]+$/.test(path)
}

// A notification the app shows through the system. `id` comes back on the click, the page knows
// what it opens.
export type DesktopNotification = { id: string; title: string; body?: string; silent?: boolean }

// What the person sets for the app itself, in the Desktop tab of their account.
export type DesktopSettings = {
    openAtLogin: boolean
    // Windows and Linux: closing the window leaves the app in the tray. macOS always does.
    closeToTray: boolean
    // Quick ask has a shortcut. Kept for the web apps that predate `quickAskShortcut`: false clears
    // the shortcut, true puts the default back.
    quickAsk: boolean
    // The global shortcut that opens Quick ask from any app, as an accelerator, or null when off.
    // Absent from the shells without the `quickAskShortcut` capability.
    quickAskShortcut?: string | null
    // The shortcut that opens Quick ask listening, or null when off. `quickAskVoiceShortcut` capability.
    quickAskVoiceShortcut?: string | null
    // The coworker dock on the edge of the screen. `coworkerDock` capability.
    coworkerDock?: boolean
}

// `taken`: the system or another app holds the keys, the previous shortcut stays. `invalid`: not a
// shortcut the shell accepts (see `quickAskAccelerator`).
export type QuickAskShortcutResult = { status: 'ok' | 'taken' | 'invalid'; settings: DesktopSettings }

// The page the Quick ask window shows: one field, sent to the Chief of Staff.
export const QUICK_ASK_PATH = '/quick-ask'

// Electron's accelerator syntax: ⌘⇧Space on macOS, Ctrl+Shift+Space elsewhere. The shortcut every
// shell shipped with; a person can now change it (`DesktopSettings.quickAskShortcut`).
export const QUICK_ASK_SHORTCUT = 'CommandOrControl+Shift+Space'

// The page the coworker dock window shows: a rail on the edge of the screen, one buddy per coworker.
export const COWORKER_DOCK_PATH = '/coworker-dock'

export const COWORKER_DOCK_MOODS = ['idle', 'working', 'error', 'waiting', 'asleep'] as const
export type CoworkerDockMood = (typeof COWORKER_DOCK_MOODS)[number]

// `pending` counts what the coworker has for the person (an unread answer, a question, an approval),
// the same items the badge of the app icon adds up.
export type CoworkerDockCoworker = { id: string; name: string; mood: CoworkerDockMood; pending: number }

// The Chief of Staff's entry among the coworkers, first unless the person moved it. A shell without
// `coworkerDockArrange` shows it like any other, and its click comes back through `onOpen`.
export const COWORKER_DOCK_FOREMAN_ID = 'chief-of-staff'

// One line of the inbox of the app, shown on the dock (`coworkerDockNotes` capability). `status` is a
// session status or `done`, a run the person has not seen. `text`: what the coworker said or asks.
// `sessionId`: the conversation the dock reads and answers; null when only the engine's id is known.
// `count`: the runs of one scheduled task folded into a `done` note.
export type CoworkerDockNote = {
    id: string
    agentId: string
    status: string
    title: string
    text: string | null
    updatedAt: string | null
    sessionId: string | null
    engineSessionId: string | null
    count?: number
}

export const COWORKER_DOCK_MAX_NOTES = 50

// Published by the main window; null once it shows no workspace (signed out, another page) or a
// workspace without coworkers. `createBlockedReason`: why "+" is disabled (a paused workspace), as
// the main window says it. `workspaceKey`: the workspace shown, under which the shell keeps the order
// and the hidden coworkers the person chose (`coworkerDockArrange` capability), and which the dock's
// own requests name. `notes`: kept by the shells with `coworkerDockNotes` only.
export type CoworkerDockState = { coworkers: CoworkerDockCoworker[]; createBlockedReason?: string | null; workspaceKey?: string; notes?: CoworkerDockNote[] } | null

export type CoworkerDockRect = { x: number; y: number; width: number; height: number }

export type CoworkerDockEdge = 'left' | 'right'

// The shortest the rail gets when its edge is dragged: the grip, one coworker and the "+".
export const COWORKER_DOCK_MIN_HEIGHT = 120

// What the dock window draws: the coworkers, in the order the person chose and without the ones they
// hid (`coworkerDockArrange`), and where the person put the rail. `y` is the middle of
// the rail, from 0 (top of the screen) to 1 (bottom). `maxHeight`: how tall the person let the rail
// grow, in pixels, before its coworkers scroll; null, it grows with them up to the screen.
export type CoworkerDockView = { state: CoworkerDockState; edge: CoworkerDockEdge; y: number; collapsed: boolean; maxHeight: number | null }

// This computer as the app sees it: the workspaces it is linked to and how each link is doing.
export type DesktopRemoteLinkStatus = 'connecting' | 'online' | 'offline' | 'revoked'

export type DesktopRemoteLink = {
    computerId: string
    name: string
    handle: string
    workspaceId: number
    workspaceName: string
    hubOrigin: string
    linkedAt: string
    status: DesktopRemoteLinkStatus
    error?: string
}

export type DesktopRemoteComputerState = {
    links: DesktopRemoteLink[]
    paused: boolean
    // Where commands start and files land unless a coworker names another folder.
    workDir: string
    // False when the system has no keychain (some Linux desktops): the tokens sit in a file only this
    // account can read, and the app says so.
    secureStorage: boolean
    runningJobs: number
    machine: { hostname: string; os: DesktopShellPlatform; arch: string; suggestedName: string }
}

export type DesktopRemoteLinkInput = { token: string; computer: { id: string; name: string; handle: string }; workspaceId: number; workspaceName: string }

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
    oauth: {
        onReturn(callback: (result: DesktopOAuthReturn) => void): Unsubscribe
    }
    notifications: {
        // False when the system refused it (notifications off for the app, an unsigned build).
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
        // The language of the app's menus, as the person picked it in Rerun.
        set(locale: string): void
    }
    server: {
        // Opens "Connect to your server", for a person whose Rerun is self-hosted.
        openPicker(): void
    }
    quickAsk: {
        // The default shortcut, as Electron writes it (`CommandOrControl+Shift+Space`). The one in use
        // is `settings.get().quickAskShortcut` on a shell with the `quickAskShortcut` capability.
        shortcut: string
        close(): void
        // The message left: the main window opens on `path`.
        sent(path: string): void
        // `quickAskShortcut` capability (`voice`: `quickAskVoiceShortcut`). Null turns that shortcut off.
        setShortcut(kind: QuickAskShortcutKind, accelerator: string | null): Promise<QuickAskShortcutResult>
        // While a new shortcut is being recorded, the current one must not open Quick ask. The shell
        // resumes by itself after 30 seconds, and as soon as `setShortcut` is called.
        pauseShortcuts(paused: boolean): void
        // `quickAskVoice` capability. While true the window stays up when it loses the focus: the
        // system asking for the microphone takes it. Hiding the window ends it.
        hold(busy: boolean): void
        // The microphone pane of the system settings. False where there is none to open (Linux).
        openMicrophoneSettings(): Promise<boolean>
        // `quickAskVoiceShortcut` capability, in the Quick ask window: the voice shortcut was pressed.
        // The shell has already brought the window up; the page starts listening, or sends.
        onShortcut(callback: (kind: QuickAskShortcutKind) => void): Unsubscribe
        // `quickAskVoiceShortcut` capability, in the Quick ask window: the shell put the window away
        // (the text shortcut, the tray, a click elsewhere). A hidden page is not told otherwise: it
        // stops listening.
        onHidden(callback: () => void): Unsubscribe
    }
    // Only with the `coworkerDock` capability.
    coworkerDock?: {
        // Main window: what the dock shows, sent again on every change.
        publish(state: CoworkerDockState): void
        // Main window: a coworker of the dock was clicked, the shell already brought the window up.
        onOpen(callback: (agentId: string) => void): Unsubscribe
        // Main window: the "+" of the dock was clicked.
        onCreate(callback: () => void): Unsubscribe
        // Dock window.
        get(): Promise<CoworkerDockView>
        onChange(callback: (view: CoworkerDockView) => void): Unsubscribe
        open(agentId: string): void
        create(): void
        // The rail was let go at this point of the screen: the shell picks the display and the edge.
        // `railY`: where the rail now stands along the edge, as `CoworkerDockView.y`; without it, the
        // shell places it from the pointer.
        drop(point: { x: number; y: number; railY?: number }): void
        // The top or the bottom edge of the rail was dragged: its new height limit, and where it now stands.
        resize(placement: { y: number; maxHeight: number | null }): void
        setCollapsed(collapsed: boolean): void
        // `agentId`: the coworker right-clicked, whose menu also hides it (`coworkerDockArrange`).
        showMenu(agentId?: string): void
        // `coworkerDockArrange` capability: the coworkers shown, in the order they were dragged to.
        reorder?(agentIds: string[]): void
        // The window lets clicks through to the apps under it, except over the rail. `rect` is the
        // rail, in the window's coordinates.
        setInteractive(interactive: boolean, rect?: CoworkerDockRect): void
        // `coworkerDockNotes` capability, from here to the end.
        // Main window: "Open in Rerun" on a note of the dock, the shell already brought the window up.
        onOpenNote?(callback: (noteId: string) => void): Unsubscribe
        // Main window: a note was marked as read, or answered, from the dock.
        onMarkRead?(callback: (noteId: string) => void): Unsubscribe
        // Dock window.
        openNote?(noteId: string): void
        markRead?(noteId: string): void
        // As `setInteractive`, over several places at once: the rail, the bubbles, the card.
        setInteractiveRegions?(interactive: boolean, rects: CoworkerDockRect[]): void
        // While the card is open the window takes the keys, for its fields, without bringing the app forward.
        setFocusable?(focusable: boolean): void
    }
    // Only with the `remoteComputer` capability.
    remoteComputer?: {
        getState(): Promise<DesktopRemoteComputerState>
        onState(callback: (state: DesktopRemoteComputerState) => void): Unsubscribe
        // Keeps the token the hub gave for this computer, in the system's keychain, and connects.
        link(input: DesktopRemoteLinkInput): Promise<DesktopRemoteComputerState>
        // Unlinks it from the workspace (told to the hub) and forgets the token.
        unlink(computerId: string): Promise<DesktopRemoteComputerState>
        setPaused(paused: boolean): Promise<DesktopRemoteComputerState>
        // Opens the system's folder picker; the state is unchanged when the person cancels.
        chooseWorkDir(): Promise<DesktopRemoteComputerState>
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
