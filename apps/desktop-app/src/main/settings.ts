import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type WindowBounds = { x?: number; y?: number; width: number; height: number; maximized: boolean }

export type ShellSettings = {
    serverUrl?: string
    windowBounds?: WindowBounds
    locale?: string
    openAtLogin?: boolean
    closeToTray?: boolean
    quickAsk?: boolean
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
