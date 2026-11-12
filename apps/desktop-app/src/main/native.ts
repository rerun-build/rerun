import { app, clipboard, Menu, nativeImage, Notification, shell, Tray, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DesktopNotification, DesktopSettings } from '@rerun/contracts'
import badgeDot from '../../resources/tray/badge.png?asset'
import trayColor from '../../resources/tray/tray.png?asset'
import trayTemplate from '../../resources/tray/trayTemplate.png?asset'
import trayTemplate2x from '../../resources/tray/trayTemplate@2x.png?asset'
import { IPC_EVENTS } from '../shared/ipc-channels'
import { PRODUCT_NAME, shellPlatform } from './identity'
import { getMainWindow, showMainWindow } from './main-window'
import { t } from './messages'
import { readSettings, updateSettings } from './settings'
import { QUICK_ASK_ACCELERATOR, setQuickAskShortcut, toggleQuickAsk } from './quick-ask'
import { isExternalUrl } from './url-policy'

// What makes the app feel installed rather than a tab: system notifications that bring back the
// right conversation, the count of what waits on the Dock or the taskbar, an icon in the menu bar or
// the notification area, launching at login, and a right-click menu.

// --- notifications ----------------------------------------------------------------------------------

// Held until clicked or closed: a notification the garbage collector takes stops answering clicks.
const shown = new Map<string, Notification>()

export function showNotification(notification: DesktopNotification): boolean {
    if (!Notification.isSupported()) return false
    const id = notification.id.slice(0, 200)
    const native = new Notification({ title: notification.title.slice(0, 200), body: notification.body?.slice(0, 1000), silent: notification.silent ?? true })
    native.on('click', () => {
        shown.delete(id)
        showMainWindow()
        getMainWindow()?.webContents.send(IPC_EVENTS.notificationClick, id)
    })
    native.on('close', () => shown.delete(id))
    native.on('failed', () => shown.delete(id))
    shown.get(id)?.close()
    shown.set(id, native)
    native.show()
    return true
}

// --- badge --------------------------------------------------------------------------------------------

let waiting = 0

export function setBadge(count: number): void {
    waiting = Math.max(0, Math.min(Math.floor(count) || 0, 9999))
    const platform = shellPlatform()
    if (platform === 'win') {
        // Windows has no count on the taskbar button: a dot over it, and the count in its tooltip.
        getMainWindow()?.setOverlayIcon(waiting > 0 ? nativeImage.createFromPath(badgeDot) : null, waiting > 0 ? t('tray.waiting', { count: waiting }) : '')
    } else {
        app.setBadgeCount(waiting)
    }
    refreshTray()
}

// --- launch at login -----------------------------------------------------------------------------------

const HIDDEN_FLAG = '--hidden'

// Started by the system at login, the app stays in the tray instead of opening its window.
export function startedAtLogin(): boolean {
    if (process.platform === 'darwin') return app.getLoginItemSettings().wasOpenedAtLogin === true
    return process.argv.includes(HIDDEN_FLAG)
}

function linuxAutostartFile(): string {
    return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart', `${app.getName().toLowerCase().replace(/\s+/g, '-')}.desktop`)
}

function applyOpenAtLogin(openAtLogin: boolean): void {
    if (process.platform === 'linux') {
        const file = linuxAutostartFile()
        if (!openAtLogin) return rmSync(file, { force: true })
        const executable = process.env.APPIMAGE || process.execPath
        mkdirSync(join(file, '..'), { recursive: true })
        writeFileSync(file, `[Desktop Entry]\nType=Application\nName=${PRODUCT_NAME}\nExec="${executable}" ${HIDDEN_FLAG}\nX-GNOME-Autostart-enabled=true\n`)
        return
    }
    app.setLoginItemSettings({ openAtLogin, args: process.platform === 'win32' ? [HIDDEN_FLAG] : undefined })
}

export function desktopSettings(): DesktopSettings {
    const settings = readSettings()
    return { openAtLogin: settings.openAtLogin ?? false, closeToTray: settings.closeToTray ?? true, quickAsk: settings.quickAsk ?? true }
}

export function changeDesktopSettings(patch: Partial<DesktopSettings>): DesktopSettings {
    const next = { ...desktopSettings() }
    if (typeof patch.openAtLogin === 'boolean' && app.isPackaged) {
        next.openAtLogin = patch.openAtLogin
        applyOpenAtLogin(next.openAtLogin)
    }
    if (typeof patch.closeToTray === 'boolean') next.closeToTray = patch.closeToTray
    if (typeof patch.quickAsk === 'boolean') {
        next.quickAsk = patch.quickAsk
        setQuickAskShortcut(next.quickAsk)
    }
    updateSettings({ openAtLogin: next.openAtLogin, closeToTray: next.closeToTray, quickAsk: next.quickAsk })
    refreshTray()
    return next
}

// --- tray ---------------------------------------------------------------------------------------------

let tray: Tray | null = null
let trayActions: { checkForUpdates: () => void; quit: () => void } | null = null

function trayImage(): Electron.NativeImage {
    if (process.platform !== 'darwin') return nativeImage.createFromPath(trayColor)
    const image = nativeImage.createEmpty()
    image.addRepresentation({ scaleFactor: 1, buffer: nativeImage.createFromPath(trayTemplate).toPNG() })
    image.addRepresentation({ scaleFactor: 2, buffer: nativeImage.createFromPath(trayTemplate2x).toPNG() })
    image.setTemplateImage(true)
    return image
}

function trayMenu(): Menu {
    const items: MenuItemConstructorOptions[] = [
        { label: t('tray.open', { name: PRODUCT_NAME }), click: () => showMainWindow() },
        { label: t('tray.quickAsk'), accelerator: QUICK_ASK_ACCELERATOR, enabled: desktopSettings().quickAsk, click: () => toggleQuickAsk() },
        ...(waiting > 0 ? [{ label: t('tray.waiting', { count: waiting }), enabled: false }] : []),
        { type: 'separator' },
        {
            label: t('tray.openAtLogin'),
            type: 'checkbox',
            checked: desktopSettings().openAtLogin,
            enabled: app.isPackaged,
            click: (item) => changeDesktopSettings({ openAtLogin: item.checked }),
        },
        { label: t('menu.app.checkForUpdates'), click: () => trayActions?.checkForUpdates() },
        { type: 'separator' },
        { label: t('menu.app.quit', { name: PRODUCT_NAME }), click: () => trayActions?.quit() },
    ]
    return Menu.buildFromTemplate(items)
}

export function refreshTray(): void {
    if (!tray) return
    tray.setToolTip(waiting > 0 ? `${PRODUCT_NAME} · ${t('tray.waiting', { count: waiting })}` : PRODUCT_NAME)
    tray.setContextMenu(trayMenu())
    if (process.platform === 'darwin') tray.setTitle(waiting > 0 ? String(waiting > 99 ? '99+' : waiting) : '')
}

export function createTray(actions: { checkForUpdates: () => void; quit: () => void }): void {
    trayActions = actions
    if (tray) return refreshTray()
    tray = new Tray(trayImage())
    // A left click opens the window where the system sends it to the app (Windows); the menu stays on
    // the right click, and on macOS on any click.
    tray.on('click', () => {
        if (process.platform !== 'darwin') showMainWindow()
    })
    refreshTray()
}

export function hasTray(): boolean {
    return tray !== null
}

let explainedBackground = false

// The first time the window closes into the tray on Windows, a balloon says the app still runs.
export function explainBackgroundOnce(): void {
    if (explainedBackground || process.platform !== 'win32' || !tray || readSettings().explainedTray) return
    explainedBackground = true
    updateSettings({ explainedTray: true })
    tray.displayBalloon({ title: PRODUCT_NAME, content: t('tray.stillRunning', { name: PRODUCT_NAME }) })
}

// --- context menu ---------------------------------------------------------------------------------------

// Electron draws no right-click menu of its own: the usual editing entries, the spelling suggestions,
// and what to do with a link or an image under the pointer.
export function attachContextMenu(contents: WebContents): void {
    contents.on('context-menu', (_event, params) => {
        const items: MenuItemConstructorOptions[] = []
        if (params.misspelledWord) {
            for (const suggestion of params.dictionarySuggestions.slice(0, 5)) items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) })
            items.push({ label: t('context.addToDictionary'), click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) })
            items.push({ type: 'separator' })
        }
        if (params.linkURL && isExternalUrl(params.linkURL)) {
            items.push({ label: t('context.openLink'), click: () => void shell.openExternal(params.linkURL) })
            items.push({ label: t('context.copyLink'), click: () => clipboard.writeText(params.linkURL) })
            items.push({ type: 'separator' })
        }
        if (params.mediaType === 'image' && params.srcURL) {
            items.push({ label: t('context.copyImage'), click: () => contents.copyImageAt(params.x, params.y) })
            items.push({ label: t('context.saveImage'), click: () => contents.downloadURL(params.srcURL) })
            items.push({ type: 'separator' })
        }
        const flags = params.editFlags
        if (params.isEditable) {
            items.push({ role: 'cut', label: t('menu.edit.cut'), enabled: flags.canCut })
            items.push({ role: 'copy', label: t('menu.edit.copy'), enabled: flags.canCopy })
            items.push({ role: 'paste', label: t('menu.edit.paste'), enabled: flags.canPaste })
            items.push({ role: 'selectAll', label: t('menu.edit.selectAll'), enabled: flags.canSelectAll })
        } else if (params.selectionText.trim()) {
            items.push({ role: 'copy', label: t('menu.edit.copy') })
        }
        while (items.at(-1)?.type === 'separator') items.pop()
        if (items.length > 0) Menu.buildFromTemplate(items).popup()
    })
}
