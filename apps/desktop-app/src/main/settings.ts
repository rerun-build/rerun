import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type WindowBounds = { x?: number; y?: number; width: number; height: number; maximized: boolean }

export type ShellSettings = {
    // The origin the app opens on, when the person picked one. Unset, the build's default.
    serverUrl?: string
    windowBounds?: WindowBounds
    // The language the web app last told the shell, for the menus.
    locale?: string
    openAtLogin?: boolean
    // Windows and Linux: closing the window keeps the app in the tray.
    closeToTray?: boolean
    // The balloon that says so was shown once.
    explainedTray?: boolean
}

const FILE_NAME = 'settings.json'

function settingsPath(): string {
    return join(app.getPath('userData'), FILE_NAME)
}

let cache: ShellSettings | null = null

export function readSettings(): ShellSettings {
    if (cache) return cache
    try {
        const parsed: unknown = JSON.parse(readFileSync(settingsPath(), 'utf8'))
        cache = parsed && typeof parsed === 'object' ? (parsed as ShellSettings) : {}
    } catch {
        cache = {}
    }
    return cache
}

// Written to a temporary file and renamed over the old one: a crash mid-write leaves the previous
// settings, never half of a JSON file.
export function updateSettings(patch: Partial<ShellSettings>): ShellSettings {
    const next = { ...readSettings(), ...patch }
    cache = next
    const path = settingsPath()
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    writeFileSync(temporary, JSON.stringify(next, null, 2))
    renameSync(temporary, path)
    return next
}
