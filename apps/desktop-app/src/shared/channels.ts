import type { DesktopShellChannel } from '@moldwright/contracts'

export const CHANNEL_IDENTITIES: Record<DesktopShellChannel, { appId: string; productName: string; executableName: string }> = {
    stable: { appId: 'build.rerun.desktop', productName: 'Rerun', executableName: 'rerun' },
    staging: { appId: 'build.rerun.desktop.staging', productName: 'Rerun Staging', executableName: 'rerun-staging' },
    dev: { appId: 'build.rerun.desktop.dev', productName: 'Rerun Dev', executableName: 'rerun-dev' },
}
