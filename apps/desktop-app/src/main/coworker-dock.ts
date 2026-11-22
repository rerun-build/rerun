import { BrowserWindow, Menu, screen, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { COWORKER_DOCK_PATH, type CoworkerDockRect, type CoworkerDockState, type CoworkerDockView } from '@rerun/contracts'
import { IPC_EVENTS } from '../shared/ipc-channels'
import { arrangeDock, arrangementKey, cleanArrangements, EMPTY_ARRANGEMENT, reorderArrangement, setHidden, withArrangement, type DockArrangement } from './coworker-dock-arrangement'
import { clamp01, dockBounds, dockDisplay, dockMaxHeight, dropPlacement, pointInRect, storedDockPlacement, type DockPlacement } from './coworker-dock-placement'
import { cleanDockState, cleanRect, cleanRects } from './coworker-dock-state'
import { currentServer, getMainWindow, openExternal, PRELOAD_PATH, showMainWindow } from './main-window'
import { t } from './messages'
import { partitionFor } from './server'
import { readSettings, updateSettings, type StoredCoworkerDock } from './settings'
import { decideNavigation } from './url-policy'

// The coworkers on the edge of the screen, above every app: a transparent strip as tall as the
// display, glued to an edge. The page draws the rail, the bubbles and the card; outside them, clicks
// go through to the apps under. The main window tells what to show (`publish`), so the dock follows
// its workspace and its badge.

// The main window left its workspace (a page reloading, the offline page, sign-in): the dock waits
// for it to publish again before it goes, so a reload does not make it blink.
const HIDE_DELAY_MS = 10_000
// Linux has no forwarded mouse moves on a window that lets clicks through: the pointer is polled.
const LINUX_POLL_MS = 100

let dockWindow: BrowserWindow | null = null
let state: CoworkerDockState = null
let publisher: WebContents | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let interactive = false
let pageWantsInput = false
let regions: CoworkerDockRect[] = []
let pollTimer: ReturnType<typeof setInterval> | null = null
let watchingDisplays = false

function placement(): DockPlacement {
    return storedDockPlacement(readSettings().coworkerDock)
}

function savePlacement(patch: StoredCoworkerDock): void {
    updateSettings({ coworkerDock: { ...readSettings().coworkerDock, ...patch } })
}

// The person's order and hidden coworkers for the workspace on screen; none from a web app that
// does not say which workspace it shows.
function currentArrangement(): { key: string; arrangement: DockArrangement } | null {
    const server = currentServer()
    if (!state?.workspaceKey || !server) return null
    const key = arrangementKey(server, state.workspaceKey)
    return { key, arrangement: cleanArrangements(readSettings().coworkerDock?.arrangements)[key] ?? EMPTY_ARRANGEMENT }
}

function saveArrangement(key: string, arrangement: DockArrangement): void {
    savePlacement({ arrangements: withArrangement(cleanArrangements(readSettings().coworkerDock?.arrangements), key, arrangement) })
    sendView()
}

function shownState(): CoworkerDockState {
    const current = currentArrangement()
    if (!state || !current) return state
    return { ...state, coworkers: arrangeDock(state.coworkers, current.arrangement) }
}

function view(): CoworkerDockView {
    const { edge, y, collapsed, maxHeight } = placement()
    return { state: shownState(), edge, y, collapsed, maxHeight }
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
    const point = { x: pointer.x - bounds.x, y: pointer.y - bounds.y }
    setInteractiveNow(pageWantsInput || regions.some((region) => pointInRect(point, region)))
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
        // Focusable only while its card is open (`setFocusable`). On macOS a panel takes the keys
        // without bringing the app forward: the app the person works in stays where it is.
        focusable: false,
        ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
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
    regions = []
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

function setCoworkerHidden(agentId: string, hidden: boolean): void {
    const current = currentArrangement()
    if (current) saveArrangement(current.key, setHidden(current.arrangement, agentId, hidden))
}

// A menu reads `&` as the mark of its access key: doubled, "R&D" keeps it.
function menuLabel(name: string): string {
    return name.replaceAll('&', '&&')
}

// Right-clicked on a coworker, its menu hides it; every menu lists them all, to bring one back.
function arrangeItems(agentId: string | null): MenuItemConstructorOptions[] {
    const current = currentArrangement()
    if (!state || !current) return []
    const hidden = new Set(current.arrangement.hidden)
    const clicked = state.coworkers.find((coworker) => coworker.id === agentId)
    return [
        ...(clicked ? [{ label: t('dock.hideCoworker', { name: menuLabel(clicked.name) }), click: () => setCoworkerHidden(clicked.id, true) }] : []),
        {
            label: t('dock.showInDock'),
            submenu: state.coworkers.map((coworker) => ({ label: menuLabel(coworker.name), type: 'checkbox' as const, checked: !hidden.has(coworker.id), click: () => setCoworkerHidden(coworker.id, !hidden.has(coworker.id)) })),
        },
        { type: 'separator' },
    ]
}

function popupMenu(window: BrowserWindow, agentId: string | null): void {
    const { edge, collapsed } = placement()
    Menu.buildFromTemplate([
        ...arrangeItems(agentId),
        { label: collapsed ? t('dock.expand') : t('dock.collapse'), click: () => setCollapsed(!collapsed) },
        edge === 'right' ? { label: t('dock.moveLeft'), click: () => moveToEdge('left') } : { label: t('dock.moveRight'), click: () => moveToEdge('right') },
        { type: 'separator' },
        { label: t('dock.hide'), click: () => setCoworkerDockEnabled(false) },
    ]).popup({ window })
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
    const next = cleanDockState(raw)
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
        const railY = Number((point as Record<string, unknown>).railY)
        savePlacement({ ...dropPlacement(at, display.workArea, Number.isFinite(railY) ? railY : null), displayId: display.id })
        place(window)
        sendView()
    },
    resize: (event: IpcMainInvokeEvent, raw: unknown) => {
        if (!fromDock(event) || !raw || typeof raw !== 'object') return
        const { y, maxHeight } = raw as Record<string, unknown>
        const next = Number(y)
        if (!Number.isFinite(next)) return
        savePlacement({ y: clamp01(next), maxHeight: dockMaxHeight(maxHeight) })
        sendView()
    },
    setCollapsed: (event: IpcMainInvokeEvent, collapsed: unknown) => {
        if (fromDock(event)) setCollapsed(collapsed === true)
    },
    showMenu: (event: IpcMainInvokeEvent, agentId: unknown) => {
        const window = fromDock(event)
        if (window) popupMenu(window, typeof agentId === 'string' && agentId ? agentId : null)
    },
    reorder: (event: IpcMainInvokeEvent, agentIds: unknown) => {
        const current = currentArrangement()
        if (!fromDock(event) || !Array.isArray(agentIds) || !state || !current) return
        const shown = agentIds.filter((id): id is string => typeof id === 'string')
        saveArrangement(current.key, reorderArrangement(current.arrangement, shown, state.coworkers.map((coworker) => coworker.id)))
    },
    setInteractive: (event: IpcMainInvokeEvent, wanted: unknown, rect: unknown) => {
        if (!fromDock(event)) return
        const railRect = cleanRect(rect)
        applyInteractive(wanted === true, railRect ? [railRect] : regions)
    },
    setRegions: (event: IpcMainInvokeEvent, wanted: unknown, rects: unknown) => {
        if (fromDock(event)) applyInteractive(wanted === true, cleanRects(rects))
    },
    openNote: (event: IpcMainInvokeEvent, noteId: unknown) => {
        if (!fromDock(event) || typeof noteId !== 'string' || !noteId) return
        toMainWindow(IPC_EVENTS.coworkerDockOpenNote, noteId.slice(0, 200))
    },
    // The main window stays where it is: only its inbox changes.
    markRead: (event: IpcMainInvokeEvent, noteId: unknown) => {
        if (!fromDock(event) || typeof noteId !== 'string' || !noteId) return
        getMainWindow()?.webContents.send(IPC_EVENTS.coworkerDockMarkRead, noteId.slice(0, 200))
    },
    setFocusable: (event: IpcMainInvokeEvent, focusable: unknown) => {
        const window = fromDock(event)
        if (!window) return
        if (focusable === true) {
            window.setFocusable(true)
            // On Windows, Electron puts a focusable window back in the taskbar.
            if (process.platform === 'win32') window.setSkipTaskbar(true)
            window.focus()
            window.webContents.focus()
            return
        }
        if (window.isFocused()) window.blur()
        window.setFocusable(false)
    },
}

function applyInteractive(wanted: boolean, next: CoworkerDockRect[]): void {
    pageWantsInput = wanted
    regions = next
    if (process.platform === 'linux') pollPointer()
    else setInteractiveNow(pageWantsInput)
}
