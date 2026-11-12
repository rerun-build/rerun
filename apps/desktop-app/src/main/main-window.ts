import { app, BrowserWindow, dialog, nativeTheme, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import type { DesktopWindowState } from '@rerun/contracts'
import { IPC_EVENTS } from '../shared/ipc-channels'
import { PRODUCT_NAME } from './identity'
import { localPageUrl } from './local-pages'
import { t } from './messages'
import { partitionFor } from './server'
import { prepareSession } from './session'
import { decideNavigation, decideWindowOpen, isExternalUrl, isSameOrigin, parseUrl } from './url-policy'
import { restoredBounds, trackBounds } from './window-state'

export const PRELOAD_PATH = join(import.meta.dirname, '../preload/index.cjs')

const LIGHT = { background: '#fafafa' }
const DARK = { background: '#0a0a0a' }

function themeColors() {
    return nativeTheme.shouldUseDarkColors ? DARK : LIGHT
}

let mainWindow: BrowserWindow | null = null
let currentOrigin: string | null = null
// The last page of the server the window showed, to come back to after the offline page.
let lastAppUrl: string | null = null
let quitting = false

// Set before anything that quits: a window closed then really closes instead of hiding (Squirrel's
// install closes every window first and never sends `before-quit`).
export function markQuitting(): void {
    quitting = true
}

app.on('before-quit', markQuitting)

export function getMainWindow(): BrowserWindow | null {
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function currentServer(): string | null {
    return currentOrigin
}

export function windowState(window: BrowserWindow): DesktopWindowState {
    return { focused: window.isFocused(), visible: window.isVisible() && !window.isMinimized(), fullscreen: window.isFullScreen(), maximized: window.isMaximized() }
}

export function showMainWindow(): void {
    const window = getMainWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
}

export async function openExternal(url: string): Promise<boolean> {
    if (!isExternalUrl(url)) return false
    await shell.openExternal(url)
    return true
}

// Popups the web app opens on the server's own pages (a sign-in popup pointed at its provider, a
// page that needs the session) live in the same session, with the browser's defaults.
function guardChildWindow(contents: WebContents, origin: string): void {
    contents.setWindowOpenHandler(({ url }) => {
        if (isExternalUrl(url)) void openExternal(url)
        return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
        if (!isExternalUrl(url) && !isSameOrigin(url, origin)) event.preventDefault()
    })
}

function guardNavigation(window: BrowserWindow, origin: string): void {
    const contents = window.webContents
    contents.on('will-navigate', (event, url) => {
        const decision = decideNavigation(url, origin)
        if (decision === 'stay') return
        event.preventDefault()
        if (decision === 'external') void openExternal(url)
    })
    contents.on('will-redirect', (event, url) => {
        if (decideNavigation(url, origin) === 'stay') return
        event.preventDefault()
        if (isExternalUrl(url)) void openExternal(url)
    })
    contents.setWindowOpenHandler(({ url }) => {
        const decision = decideWindowOpen(url, origin)
        if (decision === 'external') void openExternal(url)
        if (decision !== 'child') return { action: 'deny' }
        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                width: 520,
                height: 700,
                autoHideMenuBar: true,
                backgroundColor: themeColors().background,
                webPreferences: { partition: partitionFor(origin), sandbox: true, contextIsolation: true, nodeIntegration: false },
            },
        }
    })
    contents.on('did-create-window', (child) => guardChildWindow(child.webContents, origin))
}

// A page that refuses to unload (a coworker still working, a file with unsaved edits) would block the
// window silently: Electron shows no prompt of its own.
function confirmUnload(window: BrowserWindow): void {
    window.webContents.on('will-prevent-unload', (event) => {
        const choice = dialog.showMessageBoxSync(window, {
            type: 'question',
            buttons: [t('unload.leave'), t('unload.stay')],
            defaultId: 1,
            cancelId: 1,
            message: t('unload.message'),
            detail: t('unload.detail'),
        })
        if (choice === 0) event.preventDefault()
    })
}

function hostOf(origin: string): string {
    return parseUrl(origin)?.host ?? origin
}

export function showOfflinePage(reason: 'offline' | 'unavailable'): void {
    const window = getMainWindow()
    if (!window || !currentOrigin) return
    void window.loadURL(localPageUrl('offline', { host: hostOf(currentOrigin), reason }))
}

function watchLoadFailures(window: BrowserWindow, origin: string): void {
    const contents = window.webContents
    contents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
        // -3 is an aborted load: a navigation replaced by another, not a failure.
        if (!isMainFrame || errorCode === -3 || !isSameOrigin(url, origin)) return
        lastAppUrl = url
        showOfflinePage('offline')
    })
    contents.on('did-navigate', (_event, url, httpResponseCode) => {
        if (!isSameOrigin(url, origin)) return
        lastAppUrl = url
        // The proxy in front of the app answers 502 to 504 while a deploy swaps containers.
        if (httpResponseCode >= 502 && httpResponseCode <= 504) showOfflinePage('unavailable')
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
        if (isMainFrame && isSameOrigin(url, origin)) lastAppUrl = url
    })
    contents.on('render-process-gone', (_event, details) => {
        if (details.reason !== 'clean-exit') contents.reload()
    })
}

function broadcastWindowState(window: BrowserWindow): void {
    const send = () => {
        if (!window.isDestroyed()) window.webContents.send(IPC_EVENTS.windowState, windowState(window))
    }
    for (const name of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
        window.on(name as 'focus', send)
    }
}

export function reloadApp(): boolean {
    const window = getMainWindow()
    if (!window || !currentOrigin) return false
    void window.loadURL(lastAppUrl && isSameOrigin(lastAppUrl, currentOrigin) ? lastAppUrl : currentOrigin)
    return true
}

export function loadAppPath(path: string): void {
    const window = getMainWindow()
    if (!window || !currentOrigin) return
    void window.loadURL(new URL(path, currentOrigin).toString())
}

// Without a server yet (a build from the sources, a person who has to pick theirs), the window opens
// on the server picker, in a session of its own.
const NO_SERVER_PARTITION = 'persist:no-server'

export function createMainWindow(origin: string | null): BrowserWindow {
    currentOrigin = origin
    lastAppUrl = null
    const partition = origin ? partitionFor(origin) : NO_SERVER_PARTITION
    prepareSession(partition, origin)
    const bounds = restoredBounds()
    const window = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        minWidth: 360,
        minHeight: 480,
        show: false,
        title: PRODUCT_NAME,
        backgroundColor: themeColors().background,
        webPreferences: {
            preload: PRELOAD_PATH,
            partition,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            spellcheck: true,
            // A hidden window keeps its realtime channel and its timers: notifications and the badge
            // depend on it. Whether someone is looking is told by `window.onState`, not by
            // `document.visibilityState`.
            backgroundThrottling: false,
        },
    })
    mainWindow = window
    if (bounds.maximized) window.maximize()
    trackBounds(window)
    if (origin) {
        guardNavigation(window, origin)
        watchLoadFailures(window, origin)
    } else {
        window.webContents.on('will-navigate', (event) => event.preventDefault())
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    }
    confirmUnload(window)
    broadcastWindowState(window)

    let shown = false
    const show = () => {
        if (shown || window.isDestroyed()) return
        shown = true
        if (process.env.RERUN_DESKTOP_START_HIDDEN !== '1') window.show()
    }
    window.once('ready-to-show', show)
    // A slow first paint still shows the window, on the page's own loading state.
    setTimeout(show, 3000)

    // macOS keeps an app alive with its window closed: the window hides and comes back from the Dock
    // with everything (the realtime channel, the open conversation) as it was.
    window.on('close', (event) => {
        if (process.platform === 'darwin' && !quitting) {
            event.preventDefault()
            if (window.isFullScreen()) {
                window.once('leave-full-screen', () => window.hide())
                window.setFullScreen(false)
            } else {
                window.hide()
            }
        }
    })
    window.on('closed', () => {
        if (mainWindow === window) mainWindow = null
    })
    nativeTheme.on('updated', () => {
        if (!window.isDestroyed()) window.setBackgroundColor(themeColors().background)
    })

    void window.loadURL(origin ?? localPageUrl('server'))
    return window
}

export function showServerPicker(options: { error?: string; version?: string } = {}): void {
    const window = getMainWindow()
    if (!window) return
    const params: Record<string, string> = {}
    if (options.error) params.error = options.error
    if (options.version) params.version = options.version
    void window.loadURL(localPageUrl('server', params))
}

export function showIncompatiblePage(minShellVersion: string): void {
    const window = getMainWindow()
    if (!window || !currentOrigin) return
    void window.loadURL(localPageUrl('offline', { host: hostOf(currentOrigin), reason: 'incompatible', version: minShellVersion }))
}

// The app moves to another server: a new window in that server's session, where the old one stood.
export function replaceMainWindow(origin: string): void {
    const previous = getMainWindow()
    const next = createMainWindow(origin)
    if (previous) {
        next.setBounds(previous.getBounds())
        previous.removeAllListeners('close')
        previous.destroy()
    }
}
