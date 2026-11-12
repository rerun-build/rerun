import { DESKTOP_SHELL_API_VERSION, type DesktopServerConfig } from '@rerun/contracts'

const SEMVER = /^\d+\.\d+\.\d+$/

// Public, asked by the desktop app before it shows this server: proof that it is a Rerun hub, and the
// oldest app version it still serves. `DESKTOP_MIN_SHELL_VERSION` raises that floor when the web app
// starts relying on something older apps do not have; they then update before loading anything.
export function GET() {
    const floor = process.env.DESKTOP_MIN_SHELL_VERSION?.trim()
    const config: DesktopServerConfig = { app: 'rerun', apiVersion: DESKTOP_SHELL_API_VERSION, minShellVersion: floor && SEMVER.test(floor) ? floor : '0.0.0' }
    return Response.json(config, { headers: { 'Cache-Control': 'no-store' } })
}
