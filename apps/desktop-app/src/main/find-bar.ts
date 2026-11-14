import { WebContentsView, type BrowserWindow } from 'electron'
import type { FindRequest } from '../shared/ipc-channels'
import { IPC_EVENTS } from '../shared/ipc-channels'
import { localPageUrl } from './local-pages'
import { currentTheme, PRELOAD_PATH, TITLE_BAR_HEIGHT } from './main-window'
import { shellPlatform } from './identity'

const WIDTH = 380
const HEIGHT = 52
const MARGIN = 12

type FindBar = { view: WebContentsView; window: BrowserWindow; lastText: string; detach: () => void }

let bar: FindBar | null = null

function layout(current: FindBar): void {
    const [width] = current.window.getContentSize()
    const top = current.window.isFullScreen() ? 0 : TITLE_BAR_HEIGHT[shellPlatform()]
    current.view.setBounds({ x: Math.max(0, width - WIDTH - MARGIN), y: top + MARGIN, width: Math.min(WIDTH, width), height: HEIGHT })
}

export function openFindBar(window: BrowserWindow): void {
    if (bar && bar.window === window) {
        bar.view.webContents.focus()
        bar.view.webContents.send(IPC_EVENTS.findFocus)
        return
    }
    closeFindBar()
    const view = new WebContentsView({
        webPreferences: { preload: PRELOAD_PATH, sandbox: true, contextIsolation: true, nodeIntegration: false, session: window.webContents.session },
    })
    view.setBackgroundColor('#00000000')
    const current: FindBar = { view, window, lastText: '', detach: () => {} }
    bar = current
    window.contentView.addChildView(view)
    layout(current)
    const relayout = () => layout(current)
    const report = (_event: Electron.Event, result: Electron.Result) => {
        if (!view.webContents.isDestroyed()) view.webContents.send(IPC_EVENTS.findResult, { active: result.activeMatchOrdinal, total: result.matches })
    }
    const onNavigation = (_event: Electron.Event, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
        if (isMainFrame && !isInPlace) closeFindBar()
    }
    window.on('resize', relayout)
    window.on('enter-full-screen', relayout)
    window.on('leave-full-screen', relayout)
    window.webContents.on('found-in-page', report)
    window.webContents.on('did-start-navigation', onNavigation)
    current.detach = () => {
        window.off('resize', relayout)
        window.off('enter-full-screen', relayout)
        window.off('leave-full-screen', relayout)
        if (!window.webContents.isDestroyed()) {
            window.webContents.off('found-in-page', report)
            window.webContents.off('did-start-navigation', onNavigation)
        }
    }
    void view.webContents.loadURL(localPageUrl('find', { theme: currentTheme() }))
    view.webContents.once('did-finish-load', () => view.webContents.focus())
}

export function find(request: FindRequest): void {
    if (!bar) return
    const contents = bar.window.webContents
    if (!request.text) {
        bar.lastText = ''
        contents.stopFindInPage('clearSelection')
        bar.view.webContents.send(IPC_EVENTS.findResult, { active: 0, total: 0 })
        return
    }
    const continuing = request.findNext && request.text === bar.lastText
    bar.lastText = request.text
    contents.findInPage(request.text, { forward: request.forward, findNext: !continuing })
}

export function closeFindBar(): void {
    if (!bar) return
    const current = bar
    bar = null
    current.detach()
    if (!current.window.isDestroyed()) {
        current.window.webContents.stopFindInPage('keepSelection')
        current.window.contentView.removeChildView(current.view)
        current.window.webContents.focus()
    }
    current.view.webContents.close()
}

export function isFindBarContents(id: number): boolean {
    return bar?.view.webContents.id === id
}
