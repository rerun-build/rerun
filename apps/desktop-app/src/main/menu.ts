import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { QUICK_ASK_SHORTCUT } from '@rerun/contracts'
import { devToolsAllowed, PRODUCT_NAME } from './identity'
import { t } from './messages'

export type MenuActions = {
    openExternal: (url: string) => void
    openFind: () => void
    checkForUpdates: () => void
    changeServer: () => void
    reload: () => void
    quickAsk: () => void
}

const DOCS_URL = 'https://docs.rerun.build'

// The native menus, in the language of the app. None of them takes a shortcut the web app answers
// itself: ⌘K, ⌘F, ⌘S, ⌘Enter, ⌘Backspace stay with the page. Edit is what makes copy and paste
// work at all on macOS.
export function buildMenu(actions: MenuActions): Menu {
    const mac = process.platform === 'darwin'
    const name = PRODUCT_NAME
    const appMenu: MenuItemConstructorOptions = {
        label: name,
        submenu: [
            { role: 'about', label: t('menu.app.about', { name }) },
            { label: t('menu.app.checkForUpdates'), click: actions.checkForUpdates },
            { type: 'separator' },
            { label: t('menu.app.changeServer'), click: actions.changeServer },
            { type: 'separator' },
            { role: 'hide', label: t('menu.app.hide', { name }) },
            { role: 'hideOthers', label: t('menu.app.hideOthers') },
            { role: 'unhide', label: t('menu.app.showAll') },
            { type: 'separator' },
            { role: 'quit', label: t('menu.app.quit', { name }) },
        ],
    }
    const fileMenu: MenuItemConstructorOptions = {
        label: t('menu.file.title'),
        submenu: [
            // The shortcut is global (registered by quick-ask.ts): the menu only shows it.
            { id: 'quick-ask', label: t('tray.quickAsk'), accelerator: QUICK_ASK_SHORTCUT, registerAccelerator: false, click: actions.quickAsk },
            { type: 'separator' },
            ...(mac ? [] : [{ label: t('menu.app.checkForUpdates'), click: actions.checkForUpdates }, { label: t('menu.app.changeServer'), click: actions.changeServer }, { type: 'separator' as const }]),
            mac ? { role: 'close' as const, label: t('menu.file.closeWindow') } : { role: 'quit' as const, label: t('menu.app.quit', { name }) },
        ],
    }
    const editMenu: MenuItemConstructorOptions = {
        label: t('menu.edit.title'),
        submenu: [
            { role: 'undo', label: t('menu.edit.undo') },
            { role: 'redo', label: t('menu.edit.redo') },
            { type: 'separator' },
            { role: 'cut', label: t('menu.edit.cut') },
            { role: 'copy', label: t('menu.edit.copy') },
            { role: 'paste', label: t('menu.edit.paste') },
            ...(mac ? [{ role: 'pasteAndMatchStyle' as const, label: t('menu.edit.pasteAndMatchStyle') }] : []),
            { role: 'delete', label: t('menu.edit.delete') },
            { role: 'selectAll', label: t('menu.edit.selectAll') },
            { type: 'separator' },
            { label: t('menu.edit.find'), click: actions.openFind },
        ],
    }
    const viewMenu: MenuItemConstructorOptions = {
        label: t('menu.view.title'),
        submenu: [
            { label: t('menu.view.reload'), accelerator: 'CmdOrCtrl+R', click: actions.reload },
            ...(devToolsAllowed()
                ? [
                      { role: 'forceReload' as const, label: t('menu.view.forceReload') },
                      { role: 'toggleDevTools' as const, label: t('menu.view.toggleDevTools') },
                  ]
                : []),
            { type: 'separator' },
            { role: 'resetZoom', label: t('menu.view.actualSize') },
            { role: 'zoomIn', label: t('menu.view.zoomIn') },
            { role: 'zoomOut', label: t('menu.view.zoomOut') },
            { type: 'separator' },
            { role: 'togglefullscreen', label: t('menu.view.toggleFullScreen') },
        ],
    }
    const windowMenu: MenuItemConstructorOptions = {
        label: t('menu.window.title'),
        role: 'windowMenu',
        submenu: [
            { role: 'minimize', label: t('menu.window.minimize') },
            { role: 'zoom', label: t('menu.window.zoom') },
            ...(mac ? [{ type: 'separator' as const }, { role: 'front' as const, label: t('menu.window.front') }] : []),
        ],
    }
    const helpMenu: MenuItemConstructorOptions = {
        label: t('menu.help.title'),
        role: 'help',
        submenu: [
            { label: t('menu.help.docs'), click: () => actions.openExternal(DOCS_URL) },
        ],
    }
    return Menu.buildFromTemplate([...(mac ? [appMenu] : []), fileMenu, editMenu, viewMenu, windowMenu, helpMenu])
}

export function installMenu(actions: MenuActions): void {
    Menu.setApplicationMenu(buildMenu(actions))
    app.setAboutPanelOptions({ applicationName: PRODUCT_NAME, applicationVersion: app.getVersion(), copyright: 'Rerun · AGPL-3.0', website: 'https://rerun.build' })
}
