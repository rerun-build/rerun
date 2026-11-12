import { isDesktopShellChannel, type DesktopShellChannel } from '@rerun/contracts'

// What a build bakes in, read from the environment of `electron-vite build`:
//
//   RERUN_DESKTOP_CHANNEL       stable | staging | dev (dev under `electron-vite dev`, stable otherwise)
//   RERUN_DESKTOP_DEFAULT_URL   the server the app opens on. The official builds set it to
//                               https://app.rerun.build or https://staging.rerun.build. A build from the
//                               sources without it opens on the "Connect to your server" page.
export type BuildSettings = { channel: DesktopShellChannel; defaultServerUrl: string }

export function buildSettings(env: NodeJS.ProcessEnv = process.env): BuildSettings {
    const development = env.NODE_ENV_ELECTRON_VITE === 'development'
    const requested = env.RERUN_DESKTOP_CHANNEL
    if (requested && !isDesktopShellChannel(requested)) throw new Error(`RERUN_DESKTOP_CHANNEL must be stable, staging or dev, got "${requested}".`)
    const channel: DesktopShellChannel = isDesktopShellChannel(requested) ? requested : development ? 'dev' : 'stable'
    const localHub = `http://localhost:${env.CONDUCTOR_PORT ?? 3050}`
    const defaultServerUrl = env.RERUN_DESKTOP_DEFAULT_URL ?? (channel === 'dev' ? localHub : '')
    return { channel, defaultServerUrl }
}

export function buildDefines(): Record<string, string> {
    const settings = buildSettings()
    return {
        __RERUN_CHANNEL__: JSON.stringify(settings.channel),
        __RERUN_DEFAULT_SERVER_URL__: JSON.stringify(settings.defaultServerUrl),
    }
}
