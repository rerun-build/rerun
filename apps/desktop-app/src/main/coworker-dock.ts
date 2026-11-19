import { BrowserWindow, Menu, screen, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { COWORKER_DOCK_MOODS, COWORKER_DOCK_PATH, type CoworkerDockCoworker, type CoworkerDockMood, type CoworkerDockState, type CoworkerDockView } from '@rerun/contracts'
import { IPC_EVENTS } from '../shared/ipc-channels'
import { dockBounds, dockDisplay, dropPlacement, pointInRect, storedDockPlacement, type DockPlacement } from './coworker-dock-placement'
import { currentServer, getMainWindow, openExternal, PRELOAD_PATH, showMainWindow } from './main-window'
import { t } from './messages'
import { partitionFor } from './server'
import { readSettings, updateSettings, type StoredCoworkerDock } from './settings'
import { decideNavigation } from './url-policy'

// The coworkers on the edge of the screen, above every app: a transparent strip as tall as the
// display, glued to an edge. The page draws the rail; outside it, clicks go through to the apps under.
// The main window tells what to show (`publish`), so the dock follows its workspace and its badge.

const MAX_COWORKERS = 100
// The main window left its workspace (a page reloading, the offline page, sign-in): the dock waits
// for it to publish again before it goes, so a reload does not make it blink.
const HIDE_DELAY_MS = 10_000
// Linux has no forwarded mouse moves on a window that lets clicks through: the pointer is polled.
const LINUX_POLL_MS = 100

type Rect = { x: number; y: number; width: number; height: number }

let dockWindow: BrowserWindow | null = null
let state: CoworkerDockState = null
let publisher: WebContents | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let interactive = false
let pageWantsInput = false
let railRect: Rect | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let watchingDisplays = false

function placement(): DockPlacement {
    return storedDockPlacement(readSettings().coworkerDock)
}

function savePlacement(patch: StoredCoworkerDock): void {
    updateSettings({ coworkerDock: { ...readSettings().coworkerDock, ...patch } })
}

function view(): CoworkerDockView {
    const { edge, y, collapsed } = placement()
    return { state, edge, y, collapsed }
}

function liveWindow(): BrowserWindow | null {
    return dockWindow && !dockWindow.isDestroyed() ? dockWindow : null
}

function sendView(): void {
    liveWindow()?.webContents.send(IPC_EVENTS.coworkerDockView, view())
}

function place(window: BrowserWindow): void {
    const { edge, displayId } = placement()
    const display = dockDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay(), displayId)
    window.setBounds(dockBounds(display.workArea, edge))
}

function setInteractiveNow(next: boolean): void {
    const window = liveWindow()
    if (!window || next === interactive) return
    interactive = next
    if (next) window.setIgnoreMouseEvents(false)
    else window.setIgnoreMouseEvents(true, { forward: true })
}

function pollPointer(): void {
    const window = liveWindow()
    if (!window || !window.isVisible()) return
    const bounds = window.getBounds()
    const pointer = screen.getCursorScreenPoint()
    const overRail = railRect !== null && pointInRect({ x: pointer.x - bounds.x, y: pointer.y - bounds.y }, railRect)
    setInteractiveNow(pageWantsInput || overRail)
}

function watchDisplays(): void {
    if (watchingDisplays) return
    watchingDisplays = true
    const replace = () => {
        const window = liveWindow()
        if (window) place(window)
    }
    screen.on('display-added', replace)
    screen.on('display-removed', replace)
    screen.on('display-metrics-changed', replace)
}

function createDockWindow(origin: string): BrowserWindow {
    const window = new BrowserWindow({
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        transparent: true,
        // The rail draws its own shadow: a native one would outline the whole transparent strip.
        hasShadow: false,
        backgroundColor: '#00000000',
        webPreferences: { preload: PRELOAD_PATH, partition: partitionFor(origin), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    })
    window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.setIgnoreMouseEvents(true, { forward: true })
    interactive = false
    place(window)
    watchDisplays()
    const contents = window.webContents
    contents.on('will-navigate', (event, url) => {
        event.preventDefault()
        if (decideNavigation(url, origin) === 'external') void openExternal(url)
    })
    contents.setWindowOpenHandler(({ url }) => {
        void openExternal(url)
        return { action: 'deny' }
    })
    if (process.platform === 'linux') pollTimer = setInterval(pollPointer, LINUX_POLL_MS)
    window.on('closed', () => {
        if (pollTimer) clearInterval(pollTimer)
        pollTimer = null
        if (dockWindow === window) dockWindow = null
    })
    void window.loadURL(new URL(COWORKER_DOCK_PATH, origin).toString())
    return window
}

function showDock(): void {
    const origin = currentServer()
    if (!origin || !state || !placement().enabled) return
    const window = liveWindow() ?? (dockWindow = createDockWindow(origin))
    if (window.isVisible()) return
    // Shown without taking the focus from the app the person works in. A page the server sent
    // elsewhere (a session that expired, on its way to sign in) is never spread over the screen edge.
    const reveal = () => {
        if (!window.isDestroyed() && state && new URL(window.webContents.getURL()).pathname === COWORKER_DOCK_PATH) window.showInactive()
    }
    if (window.webContents.isLoading()) window.webContents.once('did-finish-load', reveal)
    else reveal()
}

function cancelHide(): void {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = null
}

// Cancelled by the next publication of a workspace.
function scheduleHide(): void {
    if (hideTimer) return
    hideTimer = setTimeout(() => {
        hideTimer = null
        state = null
        liveWindow()?.hide()
        sendView()
    }, HIDE_DELAY_MS)
}

export function resetCoworkerDock(): void {
    cancelHide()
    liveWindow()?.destroy()
    dockWindow = null
    state = null
    publisher = null
    railRect = null
    pageWantsInput = false
}

// The Desktop tab of the settings and "Hide Dock" both land here.
export function setCoworkerDockEnabled(enabled: boolean): void {
    savePlacement({ enabled })
    if (enabled) return showDock()
    liveWindow()?.destroy()
    dockWindow = null
}

function setCollapsed(collapsed: boolean): void {
    savePlacement({ collapsed })
    sendView()
}

function moveToEdge(edge: 'left' | 'right'): void {
    savePlacement({ edge })
    const window = liveWindow()
    if (window) place(window)
    sendView()
}

function popupMenu(window: BrowserWindow): void {
    const { edge, collapsed } = placement()
    Menu.buildFromTemplate([
        { label: collapsed ? t('dock.expand') : t('dock.collapse'), click: () => setCollapsed(!collapsed) },
        edge === 'right' ? { label: t('dock.moveLeft'), click: () => moveToEdge('left') } : { label: t('dock.moveRight'), click: () => moveToEdge('right') },
        { type: 'separator' },
        { label: t('dock.hide'), click: () => setCoworkerDockEnabled(false) },
    ]).popup({ window })
}

function cleanCoworker(raw: unknown): CoworkerDockCoworker | null {
    if (!raw || typeof raw !== 'object') return null
    const { id, name, mood, pending } = raw as Record<string, unknown>
    if (typeof id !== 'string' || !id) return null
    return {
        id: id.slice(0, 100),
        name: String(name ?? '').slice(0, 200),
        mood: (COWORKER_DOCK_MOODS as readonly string[]).includes(String(mood)) ? (mood as CoworkerDockMood) : 'idle',
        pending: Math.max(0, Math.min(9999, Math.floor(Number(pending)) || 0)),
    }
}

function cleanState(raw: unknown): CoworkerDockState {
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { coworkers?: unknown }).coworkers)) return null
    const { coworkers: rawCoworkers, createBlockedReason } = raw as { coworkers: unknown[]; createBlockedReason?: unknown }
    const coworkers = rawCoworkers.slice(0, MAX_COWORKERS).map(cleanCoworker)
    return {
        coworkers: coworkers.filter((coworker): coworker is CoworkerDockCoworker => coworker !== null),
        createBlockedReason: typeof createBlockedReason === 'string' && createBlockedReason ? createBlockedReason.slice(0, 300) : null,
    }
}

// What the main window (and only it: another window of the app shows its own workspace) publishes.
function publish(event: IpcMainInvokeEvent, raw: unknown): void {
    if (event.sender !== getMainWindow()?.webContents) return
    const sender = event.sender
    if (publisher !== sender) {
        publisher = sender
        // The main window really closed (Windows and Linux without a tray): the dock goes with it,
        // or the app would never quit.
        sender.once('destroyed', () => {
            if (publisher === sender) resetCoworkerDock()
        })
        // A page of its own replaced the app's (the routes of the app stay in the page): the page
        // that comes may never publish.
        sender.on('did-navigate', () => {
            if (publisher === sender) scheduleHide()
        })
    }
    const next = cleanState(raw)
    if (!next) return scheduleHide()
    state = next
    cancelHide()
    showDock()
    sendView()
}

function fromDock(event: IpcMainInvokeEvent): BrowserWindow | null {
    const window = liveWindow()
    return window && event.sender === window.webContents ? window : null
}

function toMainWindow(channel: string, ...args: unknown[]): void {
    showMainWindow()
    getMainWindow()?.webContents.send(channel, ...args)
}

function cleanRect(raw: unknown): Rect | null {
    if (!raw || typeof raw !== 'object') return null
    const { x, y, width, height } = raw as Record<string, unknown>
    const values = [x, y, width, height].map(Number)
    return values.every(Number.isFinite) ? { x: values[0], y: values[1], width: values[2], height: values[3] } : null
}

export const coworkerDockHandlers = {
    publish,
    get: (event: IpcMainInvokeEvent): CoworkerDockView | null => (fromDock(event) ? view() : null),
    open: (event: IpcMainInvokeEvent, agentId: unknown) => {
        if (!fromDock(event) || typeof agentId !== 'string' || !agentId) return
        toMainWindow(IPC_EVENTS.coworkerDockOpen, agentId.slice(0, 100))
    },
    create: (event: IpcMainInvokeEvent) => {
        if (fromDock(event)) toMainWindow(IPC_EVENTS.coworkerDockCreate)
    },
    drop: (event: IpcMainInvokeEvent, point: unknown) => {
        const window = fromDock(event)
        const at = cleanRect({ ...(point as object), width: 0, height: 0 })
        if (!window || !at) return
        const display = screen.getDisplayNearestPoint({ x: Math.round(at.x), y: Math.round(at.y) })
        savePlacement({ ...dropPlacement(at, display.workArea), displayId: display.id })
        place(window)
        sendView()
    },
    setCollapsed: (event: IpcMainInvokeEvent, collapsed: unknown) => {
        if (fromDock(event)) setCollapsed(collapsed === true)
    },
    showMenu: (event: IpcMainInvokeEvent) => {
        const window = fromDock(event)
        if (window) popupMenu(window)
    },
    setInteractive: (event: IpcMainInvokeEvent, wanted: unknown, rect: unknown) => {
        if (!fromDock(event)) return
        pageWantsInput = wanted === true
        railRect = cleanRect(rect) ?? railRect
        if (process.platform === 'linux') pollPointer()
        else setInteractiveNow(pageWantsInput)
    },
}
