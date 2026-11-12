import { app, dialog } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { DesktopUpdateState } from '@rerun/contracts'
import { IPC_EVENTS } from '../shared/ipc-channels'
import { CHANNEL } from './identity'
import { getMainWindow, markQuitting } from './main-window'
import { t } from './messages'

// Updates download in the background and install on the next restart, or at once when the person
// clicks the toast the web app shows. The feed (`publish` in electron-builder.config.ts) is a folder
// per channel on downloads.rerun.build; a staged rollout is `stagingPercentage` in its latest*.yml.

const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

let state: DesktopUpdateState = { status: 'idle' }
let updater: AppUpdater | null = null
let interactiveCheck = false

// A development build has no feed; `RERUN_DESKTOP_UPDATE_TEST=1` lets a packaged development build
// update from the feed it was built with, to test the whole loop locally.
export function updatesEnabled(): boolean {
    if (!app.isPackaged) return false
    return CHANNEL !== 'dev' || process.env.RERUN_DESKTOP_UPDATE_TEST === '1'
}

export function updateState(): DesktopUpdateState {
    return state
}

function publish(next: DesktopUpdateState): void {
    state = next
    getMainWindow()?.webContents.send(IPC_EVENTS.updateState, state)
}

function upToDateDialog(): void {
    const window = getMainWindow()
    const options = { type: 'info' as const, message: t('updates.upToDate'), detail: t('updates.upToDateDetail', { version: app.getVersion() }) }
    if (window) void dialog.showMessageBox(window, options)
    else void dialog.showMessageBox(options)
}

export function startUpdater(): void {
    if (!updatesEnabled() || updater) return
    const { autoUpdater } = electronUpdater
    updater = autoUpdater
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowDowngrade = false
    autoUpdater.on('checking-for-update', () => publish({ status: 'checking' }))
    autoUpdater.on('update-available', (info) => publish({ status: 'downloading', version: info.version, percent: 0 }))
    autoUpdater.on('download-progress', (progress) => {
        if (state.status === 'downloading') publish({ ...state, percent: Math.round(progress.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => publish({ status: 'ready', version: info.version }))
    autoUpdater.on('update-not-available', () => {
        publish({ status: 'idle' })
        if (interactiveCheck) upToDateDialog()
        interactiveCheck = false
    })
    autoUpdater.on('error', (error) => {
        publish({ status: 'error', message: error.message.slice(0, 300) })
        if (interactiveCheck) void dialog.showMessageBox({ type: 'warning', message: t('updates.failed'), detail: error.message.slice(0, 300) })
        interactiveCheck = false
    })
    setTimeout(() => void checkForUpdates(false), FIRST_CHECK_DELAY_MS)
    setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS)
}

export async function checkForUpdates(interactive: boolean): Promise<void> {
    if (!updater) {
        if (interactive) upToDateDialog()
        return
    }
    // An update already waiting is not fetched again: the menu then offers to install it.
    if (state.status === 'ready') {
        if (interactive) await offerInstall(state.version)
        return
    }
    if (state.status === 'checking' || state.status === 'downloading') return
    interactiveCheck = interactive
    await updater.checkForUpdates().catch(() => {})
}

async function offerInstall(version: string): Promise<void> {
    const options = {
        type: 'info' as const,
        message: t('updates.readyToInstall', { version }),
        detail: t('updates.readyDetail'),
        buttons: [t('updates.restartNow'), t('updates.later')],
        defaultId: 0,
        cancelId: 1,
    }
    const window = getMainWindow()
    const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
    if (response === 0) installUpdate()
}

export function installUpdate(): void {
    if (!updater || state.status !== 'ready') return
    markQuitting()
    // `isSilent` false: the Windows installer shows its progress; `isForceRunAfter`: the app reopens.
    updater.quitAndInstall(false, true)
}
