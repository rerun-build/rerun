import { compareShellVersions, type DesktopServerConfig } from '@rerun/contracts'

export type ServerCheck =
    | { status: 'ok'; config: DesktopServerConfig }
    | { status: 'unreachable' }
    | { status: 'not-rerun' }
    | { status: 'shell-too-old'; minShellVersion: string }

function isServerConfig(value: unknown): value is DesktopServerConfig {
    if (!value || typeof value !== 'object') return false
    const config = value as Record<string, unknown>
    return config.app === 'rerun' && typeof config.apiVersion === 'number' && typeof config.minShellVersion === 'string'
}

// Asks a server whether it is a Rerun hub this shell can show. `fetchImpl` is the session's `fetch`,
// so a staging password or a proxy the person set up answers like it does for the window.
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export async function checkServer(origin: string, shellVersion: string, fetchImpl: Fetcher, timeoutMs = 8000): Promise<ServerCheck> {
    let response: Response
    try {
        response = await fetchImpl(`${origin}/api/desktop/config`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
    } catch {
        return { status: 'unreachable' }
    }
    if (response.status >= 500) return { status: 'unreachable' }
    if (!response.ok) return { status: 'not-rerun' }
    const body: unknown = await response.json().catch(() => null)
    if (!isServerConfig(body)) return { status: 'not-rerun' }
    if (compareShellVersions(shellVersion, body.minShellVersion) < 0) return { status: 'shell-too-old', minShellVersion: body.minShellVersion }
    return { status: 'ok', config: body }
}
