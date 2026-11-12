import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { readSettings, updateSettings, type WindowBounds } from './settings'

const DEFAULT_SIZE = { width: 1440, height: 900 }

// The last size and place of the window, kept when it still fits on a connected display: a window
// saved on an external monitor that is gone reopens centered on the main one.
export function restoredBounds(): WindowBounds {
    const saved = readSettings().windowBounds
    const workArea = screen.getPrimaryDisplay().workAreaSize
    const fallback: WindowBounds = {
        width: Math.min(DEFAULT_SIZE.width, workArea.width),
        height: Math.min(DEFAULT_SIZE.height, workArea.height),
        maximized: false,
    }
    if (!saved || saved.x === undefined || saved.y === undefined) return saved ? { ...fallback, ...saved, x: undefined, y: undefined } : fallback
    const rectangle: Rectangle = { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    const display = screen.getDisplayMatching(rectangle)
    const visible =
        rectangle.x < display.workArea.x + display.workArea.width &&
        rectangle.x + rectangle.width > display.workArea.x &&
        rectangle.y < display.workArea.y + display.workArea.height &&
        rectangle.y + 40 > display.workArea.y
    return visible ? saved : { ...fallback, maximized: saved.maximized }
}

export function trackBounds(window: BrowserWindow): void {
    let timer: NodeJS.Timeout | undefined
    const save = () => {
        if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return
        const maximized = window.isMaximized()
        const bounds = maximized ? readSettings().windowBounds : window.getNormalBounds()
        updateSettings({ windowBounds: { x: bounds?.x, y: bounds?.y, width: bounds?.width ?? DEFAULT_SIZE.width, height: bounds?.height ?? DEFAULT_SIZE.height, maximized } })
    }
    const later = () => {
        clearTimeout(timer)
        timer = setTimeout(save, 400)
    }
    window.on('resize', later)
    window.on('move', later)
    window.on('maximize', save)
    window.on('unmaximize', save)
    window.on('close', save)
}
