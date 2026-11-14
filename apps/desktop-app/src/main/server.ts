import { createHash } from 'node:crypto'
import { app } from 'electron'
import { normalizeServerUrl } from './url-policy'
import { readSettings, updateSettings } from './settings'

export function serverOrigin(): string | null {
    const override = !app.isPackaged || __RERUN_CHANNEL__ !== 'stable' ? process.env.RERUN_DESKTOP_URL : undefined
    const candidate = override ?? readSettings().serverUrl ?? __RERUN_DEFAULT_SERVER_URL__
    return candidate ? normalizeServerUrl(candidate) : null
}

export function setServerOrigin(origin: string): void {
    updateSettings({ serverUrl: origin })
}

export function partitionFor(origin: string): string {
    return `persist:server-${createHash('sha256').update(origin).digest('hex').slice(0, 16)}`
}
