import { app, BrowserWindow, globalShortcut, screen, shell, type WebContents } from 'electron'
import { QUICK_ASK_PATH, QUICK_ASK_SHORTCUT_KINDS, type QuickAskShortcutKind } from '@rerun/contracts'
import { IPC_EVENTS } from '../shared/ipc-channels'
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
// The page is listening: the system's microphone prompt takes the focus and must not put it away.
let held = false
// The voice shortcut opened a window whose page is still loading: it starts listening once it asks.
let pendingVoice = false

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
        if (!held && Date.now() - shownAt > BLUR_GRACE_MS) window.hide()
    })
    const contents = window.webContents
    window.on('hide', () => contents.send(IPC_EVENTS.quickAskHidden))
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

function showQuickAsk(origin: string): BrowserWindow {
    const fresh = !quickWindow || quickWindow.isDestroyed()
    if (fresh) quickWindow = createQuickWindow(origin)
    const window = quickWindow as BrowserWindow
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
    return window
}

export function toggleQuickAsk(): void {
    const origin = currentServer()
    if (!origin) return
    if (quickWindow && quickWindow.isVisible()) return hideQuickAsk()
    showQuickAsk(origin)
}

// Unlike the text shortcut, pressing it on an open window does not put it away: the page sends
// what it is listening to.
export function voiceQuickAsk(): void {
    const origin = currentServer()
    if (!origin) return
    const loaded = quickWindow !== null && !quickWindow.isDestroyed() && !quickWindow.webContents.isLoading()
    const window = quickWindow && quickWindow.isVisible() ? quickWindow : showQuickAsk(origin)
    if (loaded) window.webContents.send(IPC_EVENTS.quickAskShortcut, 'voice')
    else pendingVoice = true
}

// Asked by the page once it listens for the shortcut.
export function takePendingQuickAsk(): QuickAskShortcutKind | null {
    const pending = pendingVoice
    pendingVoice = false
    return pending ? 'voice' : null
}

export function hideQuickAsk(): void {
    held = false
    quickWindow?.hide()
}

export function holdQuickAsk(busy: boolean): void {
    held = busy
}

const MICROPHONE_SETTINGS: Partial<Record<NodeJS.Platform, string>> = {
    darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    win32: 'ms-settings:privacy-microphone',
}

export async function openMicrophoneSettings(): Promise<boolean> {
    const url = MICROPHONE_SETTINGS[process.platform]
    if (!url) return false
    try {
        await shell.openExternal(url)
        return true
    } catch {
        return false
    }
}

// The message left: the main window comes forward on what the page names.
export function quickAskSent(path: string): void {
    hideQuickAsk()
    showMainWindow()
    if (getMainWindow()) loadAppPath(path)
}

// --- the global shortcuts -----------------------------------------------------------------------------

// Per kind, `wanted` is the person's shortcut and `registered` what the system actually gave the app:
// null while a new one is recorded, or when another app holds the keys.
type Slot = { wanted: string | null; registered: string | null; press: () => void }
const slots: Record<QuickAskShortcutKind, Slot> = {
    text: { wanted: null, registered: null, press: () => toggleQuickAsk() },
    voice: { wanted: null, registered: null, press: () => voiceQuickAsk() },
}
const PAUSE_LIMIT_MS = 30_000
let pauseTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()
const watchedRequesters = new WeakSet<WebContents>()

function release(slot: Slot): void {
    if (slot.registered) globalShortcut.unregister(slot.registered)
    slot.registered = null
}

function claim(slot: Slot, accelerator: string | null): boolean {
    if (!accelerator) return true
    try {
        if (!globalShortcut.register(accelerator, slot.press)) return false
    } catch {
        return false
    }
    slot.registered = accelerator
    return true
}

function endPause(): void {
    if (pauseTimer) clearTimeout(pauseTimer)
    pauseTimer = null
    for (const slot of Object.values(slots)) if (!slot.registered) claim(slot, slot.wanted)
}

export function quickAskShortcut(kind: QuickAskShortcutKind = 'text'): string | null {
    return slots[kind].wanted
}

export function onQuickAskShortcutChange(listener: () => void): void {
    listeners.add(listener)
}

// At launch: the stored shortcuts stay the person's even when another app holds one this time.
export function restoreQuickAskShortcuts(stored: Record<QuickAskShortcutKind, string | null>): void {
    for (const kind of QUICK_ASK_SHORTCUT_KINDS) {
        const slot = slots[kind]
        release(slot)
        slot.wanted = stored[kind]
        claim(slot, slot.wanted)
    }
}

// False when the keys are taken, by another app or by the other Quick ask shortcut: the previous
// shortcut is registered again and stays the person's.
export function setQuickAskShortcut(kind: QuickAskShortcutKind, accelerator: string | null): boolean {
    const slot = slots[kind]
    const other = slots[kind === 'text' ? 'voice' : 'text']
    if (accelerator !== null && accelerator === other.wanted) return false
    endPause()
    release(slot)
    if (!claim(slot, accelerator)) {
        claim(slot, slot.wanted)
        return false
    }
    const changed = slot.wanted !== accelerator
    slot.wanted = accelerator
    if (changed) for (const listener of listeners) listener()
    return true
}

// While the page records a new shortcut, pressing a current one must reach the page, not open
// Quick ask. A page that never says it is done (closed, crashed) does not keep them off for good.
export function pauseQuickAskShortcut(paused: boolean, requester: WebContents): void {
    if (!paused) return endPause()
    for (const slot of Object.values(slots)) release(slot)
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
