import { app, session as electronSession } from 'electron'
import { join } from 'node:path'
import { CHANNEL, PRODUCT_NAME, shellUserAgent } from './identity'
import { registerIpcHandlers } from './ipc-handlers'
import { registerLocalScheme } from './local-pages'
import { closeFindBar, openFindBar } from './find-bar'
import { createMainWindow, getMainWindow, openExternal, reloadApp, showIncompatiblePage, showMainWindow, showServerPicker } from './main-window'
import { installMenu } from './menu'
import { onLocaleChange } from './messages'
import { partitionFor, serverOrigin } from './server'
import { checkServer } from './server-check'
import { checkForUpdates, startUpdater } from './updater'

// Each channel keeps its own data: a staging or development app never reads the production session.
app.setName(PRODUCT_NAME)
const userDataOverride = !app.isPackaged || CHANNEL !== 'stable' ? process.env.RERUN_DESKTOP_USER_DATA : undefined
app.setPath('userData', userDataOverride ?? join(app.getPath('appData'), PRODUCT_NAME))

registerLocalScheme()

if (!app.requestSingleInstanceLock()) {
    app.quit()
} else {
    app.on('second-instance', () => showMainWindow())
    void app.whenReady().then(start)
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
    const origin = serverOrigin()
    createMainWindow(origin)
    if (origin) void verifyServer(origin)
    startUpdater()
}
