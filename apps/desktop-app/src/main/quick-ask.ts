import { app, BrowserWindow, globalShortcut, screen, type WebContents } from 'electron'
import { QUICK_ASK_PATH } from '@rerun/contracts'
import { currentServer, getMainWindow, loadAppPath, openExternal, PRELOAD_PATH, showMainWindow } from './main-window'
import { partitionFor } from './server'
import { decideNavigation } from './url-policy'

// A global shortcut opens a small window over whatever the person is doing, with one field: what to
// ask the Chief of Staff. Sent, it closes and the main window opens on the conversation.

const WIDTH = 640
const HEIGHT = 180

let quickWindow: BrowserWindow | null = null
let shownAt = 0
// Showing the window from another app can blur it at once, before it ever had the keyboard.
const BLUR_GRACE_MS = 500

function createQuickWindow(origin: string): BrowserWindow {
    const window = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        show: false,
        frame: false,
        resizable: false,
        movable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        transparent: true,
        hasShadow: true,
        backgroundColor: '#00000000',
        ...(process.platform === 'darwin' ? { vibrancy: 'popover' as const, visualEffectState: 'active' as const } : {}),
        webPreferences: { preload: PRELOAD_PATH, partition: partitionFor(origin), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true },
    })
    window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // Clicked away from, it goes, the way a launcher does.
    window.on('blur', () => {
        if (Date.now() - shownAt > BLUR_GRACE_MS) window.hide()
    })
    const contents = window.webContents
    contents.on('will-navigate', (event, url) => {
        const decision = decideNavigation(url, origin)
        if (decision === 'stay') return
        event.preventDefault()
        if (decision === 'external') void openExternal(url)
    })
    contents.setWindowOpenHandler(({ url }) => {
        void openExternal(url)
        return { action: 'deny' }
    })
    window.on('closed', () => {
        if (quickWindow === window) quickWindow = null
    })
    void window.loadURL(new URL(QUICK_ASK_PATH, origin).toString())
    return window
}

// Placed in the top third of the display the pointer is on, centered.
function place(window: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const { x, y, width, height } = display.workArea
    window.setBounds({ x: Math.round(x + (width - WIDTH) / 2), y: Math.round(y + height / 4), width: WIDTH, height: HEIGHT })
}

export function toggleQuickAsk(): void {
    const origin = currentServer()
    if (!origin) return
    if (quickWindow && quickWindow.isVisible()) return hideQuickAsk()
    if (!quickWindow || quickWindow.isDestroyed()) quickWindow = createQuickWindow(origin)
    const window = quickWindow
    place(window)
    const reveal = () => {
        shownAt = Date.now()
        // The shortcut is pressed in another app: the app comes forward so the field gets the keys.
        if (process.platform === 'darwin') app.focus({ steal: true })
        window.show()
        window.focus()
        window.webContents.focus()
    }
    if (window.webContents.isLoading()) window.webContents.once('did-finish-load', reveal)
    else reveal()
}

export function hideQuickAsk(): void {
    quickWindow?.hide()
}

// The message left: the main window comes forward on what the page names.
export function quickAskSent(path: string): void {
    hideQuickAsk()
    showMainWindow()
    if (getMainWindow()) loadAppPath(path)
}

// --- the global shortcut ------------------------------------------------------------------------------

// `wanted` is the person's shortcut; `registered` is what the system actually gave the app, null while
// recording a new one or when another app holds the keys.
let wanted: string | null = null
let registered: string | null = null
const PAUSE_LIMIT_MS = 30_000
let pauseTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()
const watchedRequesters = new WeakSet<WebContents>()

function release(): void {
    if (registered) globalShortcut.unregister(registered)
    registered = null
}

function claim(accelerator: string | null): boolean {
    if (!accelerator) return true
    try {
        if (!globalShortcut.register(accelerator, toggleQuickAsk)) return false
    } catch {
        return false
    }
    registered = accelerator
    return true
}

function endPause(): void {
    if (pauseTimer) clearTimeout(pauseTimer)
    pauseTimer = null
    if (!registered) claim(wanted)
}

export function quickAskShortcut(): string | null {
    return wanted
}

export function onQuickAskShortcutChange(listener: () => void): void {
    listeners.add(listener)
}

// At launch: the stored shortcut stays the person's even when another app holds it this time.
export function restoreQuickAskShortcut(accelerator: string | null): void {
    release()
    wanted = accelerator
    claim(accelerator)
}

// False when the keys are taken: the previous shortcut is registered again and stays the person's.
export function setQuickAskShortcut(accelerator: string | null): boolean {
    if (pauseTimer) clearTimeout(pauseTimer)
    pauseTimer = null
    release()
    if (!claim(accelerator)) {
        claim(wanted)
        return false
    }
    const changed = wanted !== accelerator
    wanted = accelerator
    if (changed) for (const listener of listeners) listener()
    return true
}

// While the page records a new shortcut, pressing the current one must reach the page, not open
// Quick ask. A page that never says it is done (closed, crashed) does not keep it off for good.
export function pauseQuickAskShortcut(paused: boolean, requester: WebContents): void {
    if (!paused) return endPause()
    release()
    if (pauseTimer) clearTimeout(pauseTimer)
    pauseTimer = setTimeout(endPause, PAUSE_LIMIT_MS)
    if (watchedRequesters.has(requester)) return
    watchedRequesters.add(requester)
    requester.once('destroyed', endPause)
}

// A new server (the person switched) gets a new window in its own session.
export function resetQuickAsk(): void {
    quickWindow?.destroy()
    quickWindow = null
}
