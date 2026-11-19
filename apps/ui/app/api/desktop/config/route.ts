import { DESKTOP_SHELL_API_VERSION, type DesktopServerConfig } from '@moldwright/contracts'

const SEMVER = /^\d+\.\d+\.\d+$/

export function GET() {
    const floor = process.env.DESKTOP_MIN_SHELL_VERSION?.trim()
    const config: DesktopServerConfig = { app: 'rerun', apiVersion: DESKTOP_SHELL_API_VERSION, minShellVersion: floor && SEMVER.test(floor) ? floor : '0.0.0' }
    return Response.json(config, { headers: { 'Cache-Control': 'no-store' } })
}
