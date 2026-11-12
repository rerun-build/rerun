import { app, BrowserWindow, ipcMain, session as electronSession } from 'electron'
import { isDesktopOpenPath, type DesktopNotification, type DesktopSettings, type DesktopUpdateState } from '@rerun/contracts'
import { IPC, type FindRequest, type ServerConnectResult, type ServerInfo, type ShellBootstrap } from '../shared/ipc-channels'
import { completeFromPastedCode, startBrowserSignIn } from './browser-sign-in'
import { showDownload } from './downloads'
import { closeFindBar, find, openFindBar } from './find-bar'
import { bootstrapPayload, shellPlatform } from './identity'
import { audienceOf, handle } from './ipc'
import { currentServer, getMainWindow, openExternal, reloadApp, replaceMainWindow, setTitleBarColors, windowState } from './main-window'
import { setShellLocale, shellLocale } from './messages'
import { changeDesktopSettings, desktopSettings, setBadge, showNotification } from './native'
import { hideQuickAsk, quickAskSent, resetQuickAsk } from './quick-ask'
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
    handle(IPC.windowSetChrome, ['app'], (_event, chrome: { frameColor: string; symbolColor: string }) => setTitleBarColors(chrome))
    handle(IPC.findOpen, ['app'], (event) => {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (window) openFindBar(window)
    })
    handle(IPC.linksOpenExternal, ['app'], (_event, url: string) => openExternal(String(url)))
    handle(IPC.downloadsShow, ['app'], (_event, id: string) => showDownload(String(id)))
    handle(IPC.updateGetState, ['app', 'local'], (): DesktopUpdateState => updateState())
    handle(IPC.updateCheck, ['app', 'local'], () => checkForUpdates(false))
    handle(IPC.updateInstall, ['app', 'local'], () => installUpdate())

    handle(IPC.authStart, ['app'], (_event, options: { provider?: string } | undefined) => {
        const provider = options?.provider === 'google' || options?.provider === 'apple' ? options.provider : undefined
        return startBrowserSignIn(provider)
    })
    handle(IPC.authSubmitCode, ['app'], (_event, code: string) => completeFromPastedCode(String(code ?? '').slice(0, 200)))

    handle(IPC.notificationsShow, ['app'], (_event, notification: DesktopNotification) =>
        showNotification({ id: String(notification?.id ?? ''), title: String(notification?.title ?? ''), body: typeof notification?.body === 'string' ? notification.body : undefined, silent: notification?.silent !== false }),
    )
    handle(IPC.badgeSet, ['app'], (_event, count: number) => setBadge(Number(count)))
    handle(IPC.settingsGet, ['app'], () => desktopSettings())
    handle(IPC.settingsSet, ['app'], (_event, patch: Partial<DesktopSettings>) => changeDesktopSettings({ openAtLogin: patch?.openAtLogin, closeToTray: patch?.closeToTray, quickAsk: patch?.quickAsk }))
    handle(IPC.quickAskClose, ['app'], () => hideQuickAsk())
    handle(IPC.quickAskSent, ['app'], (_event, path: string) => {
        const target = String(path ?? '/')
        quickAskSent(isDesktopOpenPath(target) ? target : '/')
    })
    handle(IPC.localeSet, ['app'], (_event, locale: string) => setShellLocale(String(locale).slice(0, 16)))

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
        setTimeout(() => {
            resetQuickAsk()
            replaceMainWindow(origin)
        }, 50)
        return { ok: true }
    })
    handle(IPC.localServerCancel, ['local'], () => {
        reloadApp()
    })
}
