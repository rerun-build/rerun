import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { QUICK_ASK_SHORTCUT } from '@rerun/contracts'
import type { CoworkerDockView, DesktopDownloadEvent, DesktopOAuthReturn, DesktopRemoteComputerState, DesktopRemoteLinkInput, DesktopSettings, DesktopShellApi, DesktopSignInResult, DesktopUpdateState, DesktopWindowState, QuickAskShortcutKind, QuickAskShortcutResult } from '@rerun/contracts'
import { IPC, IPC_EVENTS, type FindRequest, type FindResult, type ServerConnectResult, type ServerInfo, type ShellBootstrap } from '../shared/ipc-channels'

// Runs before any script of the page, in an isolated world, in the main frame only. It asks the
// main process who the page is: the configured server gets `window.rerunShell`, the shell's own
// pages get `window.rerunShellLocal`, any other page gets nothing. The main process checks the
// sender again on every call, so this is the courtesy, not the lock.

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
    const listener = (_event: IpcRendererEvent, value: T) => callback(value)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
}

const bootstrap = ipcRenderer.sendSync(IPC.bootstrap) as ShellBootstrap

if (bootstrap?.audience === 'app') {
    const api: DesktopShellApi = {
        apiVersion: bootstrap.apiVersion,
        version: bootstrap.version,
        platform: bootstrap.platform,
        channel: bootstrap.channel,
        capabilities: bootstrap.capabilities,
        window: {
            getState: () => ipcRenderer.invoke(IPC.windowGetState) as Promise<DesktopWindowState>,
            onState: (callback) => subscribe(IPC_EVENTS.windowState, callback),
            setChrome: (chrome) => void ipcRenderer.invoke(IPC.windowSetChrome, { frameColor: String(chrome.frameColor), symbolColor: String(chrome.symbolColor) }),
        },
        find: {
            open: () => void ipcRenderer.invoke(IPC.findOpen),
        },
        links: {
            openExternal: (url) => ipcRenderer.invoke(IPC.linksOpenExternal, String(url)) as Promise<boolean>,
        },
        update: {
            getState: () => ipcRenderer.invoke(IPC.updateGetState) as Promise<DesktopUpdateState>,
            onState: (callback) => subscribe(IPC_EVENTS.updateState, callback),
            check: () => void ipcRenderer.invoke(IPC.updateCheck),
            install: () => void ipcRenderer.invoke(IPC.updateInstall),
        },
        auth: {
            startBrowserSignIn: (options) => ipcRenderer.invoke(IPC.authStart, { provider: options?.provider }) as Promise<void>,
            submitCode: (code) => ipcRenderer.invoke(IPC.authSubmitCode, String(code)) as Promise<DesktopSignInResult>,
            onResult: (callback) => subscribe<DesktopSignInResult>(IPC_EVENTS.authResult, callback),
        },
        downloads: {
            onEvent: (callback) => subscribe<DesktopDownloadEvent>(IPC_EVENTS.download, callback),
            show: (id) => void ipcRenderer.invoke(IPC.downloadsShow, String(id)),
        },
        oauth: {
            onReturn: (callback) => subscribe<DesktopOAuthReturn>(IPC_EVENTS.oauthReturn, callback),
        },
        notifications: {
            show: (notification) => ipcRenderer.invoke(IPC.notificationsShow, { id: String(notification.id), title: String(notification.title), body: notification.body === undefined ? undefined : String(notification.body), silent: notification.silent !== false }) as Promise<boolean>,
            onClick: (callback) => subscribe<string>(IPC_EVENTS.notificationClick, callback),
        },
        badge: {
            set: (count) => void ipcRenderer.invoke(IPC.badgeSet, Number(count) || 0),
        },
        settings: {
            get: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<DesktopSettings>,
            set: (patch) => ipcRenderer.invoke(IPC.settingsSet, { openAtLogin: patch.openAtLogin, closeToTray: patch.closeToTray, quickAsk: patch.quickAsk, coworkerDock: patch.coworkerDock }) as Promise<DesktopSettings>,
        },
        locale: {
            set: (locale) => void ipcRenderer.invoke(IPC.localeSet, String(locale)),
        },
        server: {
            openPicker: () => void ipcRenderer.invoke(IPC.serverOpenPicker),
        },
        quickAsk: {
            shortcut: QUICK_ASK_SHORTCUT,
            close: () => void ipcRenderer.invoke(IPC.quickAskClose),
            sent: (path) => void ipcRenderer.invoke(IPC.quickAskSent, String(path)),
            setShortcut: (kind, accelerator) => ipcRenderer.invoke(IPC.quickAskSetShortcut, { kind: String(kind), accelerator: accelerator === null ? null : String(accelerator) }) as Promise<QuickAskShortcutResult>,
            pauseShortcuts: (paused) => void ipcRenderer.invoke(IPC.quickAskPauseShortcuts, paused === true),
            hold: (busy) => void ipcRenderer.invoke(IPC.quickAskHold, busy === true),
            openMicrophoneSettings: () => ipcRenderer.invoke(IPC.quickAskOpenMicrophoneSettings) as Promise<boolean>,
            onShortcut: (callback) => {
                const unsubscribe = subscribe<QuickAskShortcutKind>(IPC_EVENTS.quickAskShortcut, callback)
                // The shortcut that opened the window may have been pressed before the page could hear it.
                void (ipcRenderer.invoke(IPC.quickAskTakePending) as Promise<QuickAskShortcutKind | null>).then((kind) => {
                    if (kind) callback(kind)
                })
                return unsubscribe
            },
            onHidden: (callback) => subscribe<void>(IPC_EVENTS.quickAskHidden, () => callback()),
        },
        coworkerDock: {
            publish: (state) =>
                void ipcRenderer.invoke(
                    IPC.coworkerDockPublish,
                    state
                        ? {
                              coworkers: state.coworkers.map((coworker) => ({ id: String(coworker.id), name: String(coworker.name), mood: String(coworker.mood), pending: Number(coworker.pending) || 0 })),
                              createBlockedReason: typeof state.createBlockedReason === 'string' ? state.createBlockedReason : null,
                              workspaceKey: typeof state.workspaceKey === 'string' ? state.workspaceKey : undefined,
                              notes: Array.isArray(state.notes) ? state.notes.map((note) => ({ ...note })) : undefined,
                          }
                        : null,
                ),
            onOpen: (callback) => subscribe<string>(IPC_EVENTS.coworkerDockOpen, callback),
            onCreate: (callback) => subscribe<void>(IPC_EVENTS.coworkerDockCreate, () => callback()),
            get: () => ipcRenderer.invoke(IPC.coworkerDockGet) as Promise<CoworkerDockView>,
            onChange: (callback) => subscribe<CoworkerDockView>(IPC_EVENTS.coworkerDockView, callback),
            open: (agentId) => void ipcRenderer.invoke(IPC.coworkerDockOpen, String(agentId)),
            create: () => void ipcRenderer.invoke(IPC.coworkerDockCreate),
            drop: (point) => void ipcRenderer.invoke(IPC.coworkerDockDrop, { x: Number(point.x), y: Number(point.y), railY: point.railY === undefined ? undefined : Number(point.railY) }),
            resize: (placement) => void ipcRenderer.invoke(IPC.coworkerDockResize, { y: Number(placement.y), maxHeight: placement.maxHeight === null ? null : Number(placement.maxHeight) }),
            setCollapsed: (collapsed) => void ipcRenderer.invoke(IPC.coworkerDockSetCollapsed, collapsed === true),
            showMenu: (agentId) => void ipcRenderer.invoke(IPC.coworkerDockShowMenu, typeof agentId === 'string' ? agentId : undefined),
            reorder: (agentIds) => void ipcRenderer.invoke(IPC.coworkerDockReorder, Array.isArray(agentIds) ? agentIds.map(String) : []),
            setInteractive: (interactive, rect) =>
                void ipcRenderer.invoke(IPC.coworkerDockSetInteractive, interactive === true, rect ? { x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height) } : undefined),
            onOpenNote: (callback) => subscribe<string>(IPC_EVENTS.coworkerDockOpenNote, callback),
            onMarkRead: (callback) => subscribe<string>(IPC_EVENTS.coworkerDockMarkRead, callback),
            openNote: (noteId) => void ipcRenderer.invoke(IPC.coworkerDockOpenNote, String(noteId)),
            markRead: (noteId) => void ipcRenderer.invoke(IPC.coworkerDockMarkRead, String(noteId)),
            setInteractiveRegions: (interactive, rects) =>
                void ipcRenderer.invoke(
                    IPC.coworkerDockSetRegions,
                    interactive === true,
                    Array.isArray(rects) ? rects.map((rect) => ({ x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height) })) : [],
                ),
            setFocusable: (focusable) => void ipcRenderer.invoke(IPC.coworkerDockSetFocusable, focusable === true),
        },
        remoteComputer: {
            getState: () => ipcRenderer.invoke(IPC.remoteComputerGetState) as Promise<DesktopRemoteComputerState>,
            onState: (callback) => subscribe<DesktopRemoteComputerState>(IPC_EVENTS.remoteComputerState, callback),
            link: (input: DesktopRemoteLinkInput) =>
                ipcRenderer.invoke(IPC.remoteComputerLink, {
                    token: String(input.token),
                    computer: { id: String(input.computer.id), name: String(input.computer.name), handle: String(input.computer.handle) },
                    workspaceId: Number(input.workspaceId),
                    workspaceName: String(input.workspaceName),
                }) as Promise<DesktopRemoteComputerState>,
            unlink: (computerId) => ipcRenderer.invoke(IPC.remoteComputerUnlink, String(computerId)) as Promise<DesktopRemoteComputerState>,
            setPaused: (paused) => ipcRenderer.invoke(IPC.remoteComputerSetPaused, paused === true) as Promise<DesktopRemoteComputerState>,
            chooseWorkDir: () => ipcRenderer.invoke(IPC.remoteComputerChooseWorkDir) as Promise<DesktopRemoteComputerState>,
        },
    }
    contextBridge.exposeInMainWorld('rerunShell', api)
}

if (bootstrap?.audience === 'local') {
    contextBridge.exposeInMainWorld('rerunShellLocal', {
        locale: bootstrap.locale,
        platform: bootstrap.platform,
        retry: () => ipcRenderer.invoke(IPC.localRetry) as Promise<boolean>,
        updateState: () => ipcRenderer.invoke(IPC.updateGetState) as Promise<DesktopUpdateState>,
        onUpdateState: (callback: (state: DesktopUpdateState) => void) => subscribe(IPC_EVENTS.updateState, callback),
        checkForUpdates: () => void ipcRenderer.invoke(IPC.updateCheck),
        installUpdate: () => void ipcRenderer.invoke(IPC.updateInstall),
        serverInfo: () => ipcRenderer.invoke(IPC.localServerInfo) as Promise<ServerInfo>,
        connect: (address: string) => ipcRenderer.invoke(IPC.localServerConnect, String(address)) as Promise<ServerConnectResult>,
        cancelServerChange: () => void ipcRenderer.invoke(IPC.localServerCancel),
        find: (request: FindRequest) => void ipcRenderer.invoke(IPC.localFind, { text: String(request.text), forward: !!request.forward, findNext: !!request.findNext }),
        closeFind: () => void ipcRenderer.invoke(IPC.localFindClose),
        onFindResult: (callback: (result: FindResult) => void) => subscribe(IPC_EVENTS.findResult, callback),
        onFindFocus: (callback: () => void) => subscribe(IPC_EVENTS.findFocus, callback),
    })
}
