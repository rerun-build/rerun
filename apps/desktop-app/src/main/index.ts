import { app, session as electronSession } from 'electron'
import { join, resolve } from 'node:path'
import { completeFromLink } from './browser-sign-in'
import { deepLinkInArgv, parseDeepLink } from './deep-links'
import { CHANNEL, PRODUCT_NAME, SCHEME, shellUserAgent } from './identity'
import { registerIpcHandlers } from './ipc-handlers'
import { IPC_EVENTS } from '../shared/ipc-channels'
import { registerLocalScheme } from './local-pages'
import { closeFindBar, openFindBar } from './find-bar'
import { createMainWindow, getMainWindow, openExternal, reloadApp, showIncompatiblePage, showMainWindow, showServerPicker } from './main-window'
import { installMenu } from './menu'
import { onLocaleChange } from './messages'
import { partitionFor, serverOrigin } from './server'
import { checkServer } from './server-check'
import { checkForUpdates, startUpdater } from './updater'
import { createTray, refreshTray, startedAtLogin } from './native'

// Each channel keeps its own data: a staging or development app never reads the production session.
app.setName(PRODUCT_NAME)
const userDataOverride = !app.isPackaged || CHANNEL !== 'stable' ? process.env.RERUN_DESKTOP_USER_DATA : undefined
app.setPath('userData', userDataOverride ?? join(app.getPath('appData'), PRODUCT_NAME))

registerLocalScheme()

// Links to the app's scheme: macOS sends them as `open-url`, before `ready` for the one that launched
// the app; Windows and Linux start a second instance with the link in its arguments.
let ready = false
const waitingLinks: string[] = []

function receiveLink(raw: string): void {
    if (!ready) {
        waitingLinks.push(raw)
        return
    }
    const link = parseDeepLink(raw, SCHEME)
    if (link?.kind === 'auth-callback') void completeFromLink(link.code, link.state)
    if (link?.kind === 'oauth-return') {
        showMainWindow()
        getMainWindow()?.webContents.send(IPC_EVENTS.oauthReturn, link.result)
    }
}

app.on('open-url', (event, url) => {
    event.preventDefault()
    receiveLink(url)
})

if (!app.requestSingleInstanceLock()) {
    app.quit()
} else {
    app.on('second-instance', (_event, argv) => {
        showMainWindow()
        const link = deepLinkInArgv(argv, SCHEME)
        if (link) receiveLink(link)
    })
    const launchLink = deepLinkInArgv(process.argv, SCHEME)
    if (launchLink) waitingLinks.push(launchLink)
    void app.whenReady().then(start)
}

// A packaged app declares its scheme in its bundle; registering it again makes it the handler. Run
// from the sources, only Windows can point the scheme at Electron with the app's path; macOS and
// Linux need the packaged app.
function registerScheme(): void {
    if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME)
    else if (process.platform === 'win32' && process.argv[1]) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [resolve(process.argv[1])])
}

// No page of any origin may embed a <webview>: it would run outside every rule set here.
app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
})

app.on('activate', () => {
    if (getMainWindow()) showMainWindow()
    else createMainWindow(serverOrigin())
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

function menu(): void {
    installMenu({
        openExternal: (url) => void openExternal(url),
        openFind: () => {
            const window = getMainWindow()
            if (window) openFindBar(window)
        },
        checkForUpdates: () => void checkForUpdates(true),
        changeServer: () => {
            closeFindBar()
            showMainWindow()
            showServerPicker()
        },
        reload: () => reloadApp(),
    })
}

// The window loads at once; the server is asked in parallel whether it serves this version. An
// unreachable server is the offline page's business, the window finds out by itself.
async function verifyServer(origin: string): Promise<void> {
    const session = electronSession.fromPartition(partitionFor(origin))
    const check = await checkServer(origin, app.getVersion(), session.fetch.bind(session))
    if (check.status === 'shell-too-old') showIncompatiblePage(check.minShellVersion)
    if (check.status === 'not-rerun') showServerPicker({ error: 'notRerun' })
}

function start(): void {
    app.userAgentFallback = shellUserAgent(app.userAgentFallback)
    registerIpcHandlers()
    menu()
    onLocaleChange(menu)
    onLocaleChange(refreshTray)
    const origin = serverOrigin()
    createMainWindow(origin, { hidden: startedAtLogin() })
    createTray({ checkForUpdates: () => void checkForUpdates(true), quit: () => app.quit() })
    if (origin) void verifyServer(origin)
    startUpdater()
    registerScheme()
    ready = true
    for (const link of waitingLinks.splice(0)) receiveLink(link)
}
