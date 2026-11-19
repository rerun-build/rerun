import { app, BrowserWindow, dialog, nativeTheme, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import type { DesktopWindowState } from '@moldwright/contracts'
import { IPC_EVENTS } from '../shared/ipc-channels'
import { PRODUCT_NAME, shellPlatform } from './identity'
import { localPageUrl } from './local-pages'
import { t } from './messages'
import { partitionFor } from './server'
import { prepareSession } from './session'
import { decideNavigation, decideWindowOpen, isExternalUrl, isSameOrigin, parseUrl } from './url-policy'
import { restoredBounds, trackBounds } from './window-state'
import { attachContextMenu, desktopSettings, explainBackgroundOnce, hasTray } from './native'

export const PRELOAD_PATH = join(import.meta.dirname, '../preload/index.cjs')

export const TITLE_BAR_HEIGHT = { mac: 28, win: 32, linux: 32 } as const

const LIGHT = { background: '#fafafa', symbol: '#0a0a0a' }
const DARK = { background: '#0a0a0a', symbol: '#fafafa' }

function themeColors() {
    return nativeTheme.shouldUseDarkColors ? DARK : LIGHT
}

function titleBarOptions(): Electron.BrowserWindowConstructorOptions {
    const platform = shellPlatform()
    if (platform === 'mac') return { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 8 } }
    const colors = themeColors()
    return { titleBarStyle: 'hidden', titleBarOverlay: { color: colors.background, symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT[platform] } }
}

let mainWindow: BrowserWindow | null = null
let currentOrigin: string | null = null
let lastAppUrl: string | null = null
let quitting = false

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

function guardChildWindow(contents: WebContents, origin: string): void {
    contents.setWindowOpenHandler(({ url }) => {
        if (isExternalUrl(url)) void openExternal(url)
        return { action: 'deny' }
    })
    const leave = (event: Electron.Event, url: string) => {
        if (isSameOrigin(url, origin)) return
        event.preventDefault()
        if (isExternalUrl(url)) void openExternal(url)
        BrowserWindow.fromWebContents(contents)?.close()
    }
    contents.on('will-navigate', leave)
    contents.on('will-redirect', leave)
}

function guardNavigation(window: BrowserWindow, origin: string): void {
    const contents = window.webContents
    const away = (event: Electron.Event, url: string) => {
        const decision = decideNavigation(url, origin)
        if (decision === 'stay') return
        event.preventDefault()
        if (decision === 'external') void openExternal(url)
    }
    contents.on('will-navigate', away)
    contents.on('will-redirect', away)
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
    void window.loadURL(localPageUrl('offline', { host: hostOf(currentOrigin), reason, theme: currentTheme() }))
}

function watchLoadFailures(window: BrowserWindow, origin: string): void {
    const contents = window.webContents
    contents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
        if (!isMainFrame || errorCode === -3 || !isSameOrigin(url, origin)) return
        lastAppUrl = url
        showOfflinePage('offline')
    })
    contents.on('did-navigate', (_event, url, httpResponseCode) => {
        if (!isSameOrigin(url, origin)) return
        lastAppUrl = url
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

function appWindowOptions(partition: string, bounds: { x?: number; y?: number; width: number; height: number }): Electron.BrowserWindowConstructorOptions {
    return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        minWidth: 360,
        minHeight: 480,
        show: false,
        title: PRODUCT_NAME,
        backgroundColor: themeColors().background,
        ...titleBarOptions(),
        webPreferences: {
            preload: PRELOAD_PATH,
            partition,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            spellcheck: true,
            backgroundThrottling: false,
        },
    }
}

const CASCADE = 28

export function openNewWindow(): BrowserWindow | null {
    const origin = currentOrigin
    const main = getMainWindow()
    if (!origin || !main) return null
    const from = BrowserWindow.getFocusedWindow() ?? main
    const { x, y, width, height } = from.getBounds()
    const window = new BrowserWindow(appWindowOptions(partitionFor(origin), { x: x + CASCADE, y: y + CASCADE, width, height }))
    guardNavigation(window, origin)
    confirmUnload(window)
    broadcastWindowState(window)
    attachContextMenu(window.webContents)
    window.once('ready-to-show', () => window.show())
    const page = from.webContents.getURL()
    void window.loadURL(isSameOrigin(page, origin) ? page : origin)
    return window
}

const NO_SERVER_PARTITION = 'persist:no-server'

export function createMainWindow(origin: string | null, options: { hidden?: boolean } = {}): BrowserWindow {
    currentOrigin = origin
    lastAppUrl = null
    const partition = origin ? partitionFor(origin) : NO_SERVER_PARTITION
    prepareSession(partition, origin)
    const bounds = restoredBounds()
    const window = new BrowserWindow(appWindowOptions(partition, bounds))
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
    attachContextMenu(window.webContents)

    let shown = false
    const show = () => {
        if (shown || window.isDestroyed()) return
        shown = true
        if (!options.hidden && process.env.RERUN_DESKTOP_START_HIDDEN !== '1') window.show()
    }
    window.once('ready-to-show', show)
    setTimeout(show, 3000)

    window.on('close', (event) => {
        if (process.platform !== 'darwin' && !quitting && hasTray() && desktopSettings().closeToTray) {
            event.preventDefault()
            window.hide()
            explainBackgroundOnce()
            return
        }
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
    void window.loadURL(localPageUrl('offline', { host: hostOf(currentOrigin), reason: 'incompatible', version: minShellVersion, theme: currentTheme() }))
}

export function replaceMainWindow(origin: string): void {
    const previous = getMainWindow()
    const next = createMainWindow(origin)
    if (previous) {
        next.setBounds(previous.getBounds())
        previous.removeAllListeners('close')
        previous.destroy()
    }
}

let appTheme: 'light' | 'dark' | null = null

export function currentTheme(): 'light' | 'dark' {
    return appTheme ?? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
}

export function setTitleBarColors(chrome: { frameColor: string; symbolColor: string }): void {
    if (/^#[0-9a-f]{6}$/i.test(chrome.symbolColor)) appTheme = parseInt(chrome.symbolColor.slice(1, 3), 16) > 0x80 ? 'dark' : 'light'
    const window = getMainWindow()
    const platform = shellPlatform()
    if (!window || platform === 'mac') return
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(chrome.frameColor) || !/^#[0-9a-f]{6}$/i.test(chrome.symbolColor)) return
    window.setTitleBarOverlay({ color: chrome.frameColor, symbolColor: chrome.symbolColor, height: TITLE_BAR_HEIGHT[platform] })
}
