import { createHash } from 'node:crypto'
import { app } from 'electron'
import { normalizeServerUrl } from './url-policy'
import { readSettings, updateSettings } from './settings'

// The server the app shows. `RERUN_DESKTOP_URL` points a development or test build at another hub
// (the local one of a worktree, a second one for the self-hosted tests); a packaged stable build
// ignores it, so nothing in the environment can send a customer's app elsewhere.
export function serverOrigin(): string | null {
    const override = !app.isPackaged || __RERUN_CHANNEL__ !== 'stable' ? process.env.RERUN_DESKTOP_URL : undefined
    const candidate = override ?? readSettings().serverUrl ?? __RERUN_DEFAULT_SERVER_URL__
    return candidate ? normalizeServerUrl(candidate) : null
}

export function setServerOrigin(origin: string): void {
    updateSettings({ serverUrl: origin })
}

// One cookie jar per server: signing in to a self-hosted server never sees the session of another.
export function partitionFor(origin: string): string {
    return `persist:server-${createHash('sha256').update(origin).digest('hex').slice(0, 16)}`
}
