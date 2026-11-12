import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { QUICK_ASK_SHORTCUT } from '@rerun/contracts'
import type { DesktopDownloadEvent, DesktopOAuthReturn, DesktopSettings, DesktopShellApi, DesktopSignInResult, DesktopUpdateState, DesktopWindowState } from '@rerun/contracts'
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
            set: (patch) => ipcRenderer.invoke(IPC.settingsSet, { openAtLogin: patch.openAtLogin, closeToTray: patch.closeToTray, quickAsk: patch.quickAsk }) as Promise<DesktopSettings>,
        },
        locale: {
            set: (locale) => void ipcRenderer.invoke(IPC.localeSet, String(locale)),
        },
        quickAsk: {
            shortcut: QUICK_ASK_SHORTCUT,
            close: () => void ipcRenderer.invoke(IPC.quickAskClose),
            sent: (path) => void ipcRenderer.invoke(IPC.quickAskSent, String(path)),
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
