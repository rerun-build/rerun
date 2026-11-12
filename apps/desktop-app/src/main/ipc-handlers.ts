import { app, BrowserWindow, ipcMain, session as electronSession } from 'electron'
import type { DesktopUpdateState } from '@rerun/contracts'
import { IPC, type FindRequest, type ServerConnectResult, type ServerInfo, type ShellBootstrap } from '../shared/ipc-channels'
import { showDownload } from './downloads'
import { closeFindBar, find, openFindBar } from './find-bar'
import { bootstrapPayload, shellPlatform } from './identity'
import { audienceOf, handle } from './ipc'
import { currentServer, getMainWindow, openExternal, reloadApp, replaceMainWindow, windowState } from './main-window'
import { shellLocale } from './messages'
import { partitionFor, serverOrigin, setServerOrigin } from './server'
import { checkServer } from './server-check'
import { checkForUpdates, installUpdate, updatesEnabled, updateState } from './updater'
import { normalizeServerUrl } from './url-policy'

export function registerIpcHandlers(): void {
    ipcMain.on(IPC.bootstrap, (event) => {
        const audience = audienceOf(event)
        let payload: ShellBootstrap = null
        if (audience === 'app') payload = { audience, ...bootstrapPayload(updatesEnabled() ? ['update'] : []) }
        if (audience === 'local') payload = { audience, locale: shellLocale(), platform: shellPlatform() }
        event.returnValue = payload
    })

    handle(IPC.windowGetState, ['app'], (event) => {
        const window = BrowserWindow.fromWebContents(event.sender)
        return window ? windowState(window) : null
    })
    handle(IPC.findOpen, ['app'], (event) => {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (window) openFindBar(window)
    })
    handle(IPC.linksOpenExternal, ['app'], (_event, url: string) => openExternal(String(url)))
    handle(IPC.downloadsShow, ['app'], (_event, id: string) => showDownload(String(id)))
    handle(IPC.updateGetState, ['app', 'local'], (): DesktopUpdateState => updateState())
    handle(IPC.updateCheck, ['app', 'local'], () => checkForUpdates(false))
    handle(IPC.updateInstall, ['app', 'local'], () => installUpdate())

    handle(IPC.localFind, ['local'], (_event, request: FindRequest) => find({ text: String(request?.text ?? '').slice(0, 500), forward: request?.forward !== false, findNext: !!request?.findNext }))
    handle(IPC.localFindClose, ['local'], () => closeFindBar())

    // The offline page's "Try again", and its own polling.
    handle(IPC.localRetry, ['local'], async () => {
        const origin = currentServer()
        if (!origin) return false
        const session = electronSession.fromPartition(partitionFor(origin))
        const check = await checkServer(origin, app.getVersion(), session.fetch.bind(session), 5000)
        if (check.status === 'unreachable') return false
        return reloadApp()
    })

    handle(IPC.localServerInfo, ['local'], (): ServerInfo => {
        const current = serverOrigin()
        return { current, defaultServer: normalizeServerUrl(__RERUN_DEFAULT_SERVER_URL__ || ''), canCancel: !!current && !!getMainWindow() && currentServer() === current }
    })
    handle(IPC.localServerConnect, ['local'], async (_event, address: string): Promise<ServerConnectResult> => {
        const origin = normalizeServerUrl(String(address ?? ''))
        if (!origin) return { ok: false, reason: 'invalid' }
        const session = electronSession.fromPartition(partitionFor(origin))
        const check = await checkServer(origin, app.getVersion(), session.fetch.bind(session))
        if (check.status === 'unreachable') return { ok: false, reason: 'unreachable' }
        if (check.status === 'not-rerun') return { ok: false, reason: 'notRerun' }
        if (check.status === 'shell-too-old') return { ok: false, reason: 'tooOld', version: check.minShellVersion }
        setServerOrigin(origin)
        // Answered before the window that asked is replaced.
        setTimeout(() => replaceMainWindow(origin), 50)
        return { ok: true }
    })
    handle(IPC.localServerCancel, ['local'], () => {
        reloadApp()
    })
}
