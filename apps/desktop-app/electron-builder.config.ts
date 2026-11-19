import type { Configuration } from 'electron-builder'
import { desktopShellScheme } from '@moldwright/contracts'
import { buildSettings } from './build-config'
import { CHANNEL_IDENTITIES } from './src/shared/channels'

const settings = buildSettings()
const channel = settings.channel
const e2e = process.env.RERUN_DESKTOP_E2E === '1'

const identity = CHANNEL_IDENTITIES[channel]
const icon = `resources/icons/${channel}/icon.png`
const updateFeed = process.env.RERUN_DESKTOP_UPDATE_URL
const developerId = Boolean(process.env.CSC_LINK || process.env.CSC_NAME)
const notarize = Boolean(process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER)
const azureSigning = process.env.RERUN_AZURE_SIGNING_ENDPOINT
    ? {
          publisherName: process.env.RERUN_AZURE_SIGNING_PUBLISHER ?? 'Rerun',
          endpoint: process.env.RERUN_AZURE_SIGNING_ENDPOINT,
          certificateProfileName: process.env.RERUN_AZURE_SIGNING_PROFILE ?? '',
          codeSigningAccountName: process.env.RERUN_AZURE_SIGNING_ACCOUNT ?? '',
      }
    : undefined

const config: Configuration = {
    appId: identity.appId,
    productName: identity.productName,
    copyright: 'Copyright © Rerun. AGPL-3.0.',
    directories: { output: `release/${channel}`, buildResources: 'resources' },
    files: ['out/**/*', 'package.json'],
    extraMetadata: { productName: identity.productName },
    asar: true,
    npmRebuild: false,
    protocols: [{ name: identity.productName, schemes: [desktopShellScheme(channel)] }],
    publish: updateFeed ? [{ provider: 'generic', url: updateFeed }] : undefined,
    electronFuses: {
        runAsNode: false,
        enableCookieEncryption: true,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: e2e,
        enableEmbeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true,
        grantFileProtocolExtraPrivileges: false,
    },
    mac: {
        target: [
            { target: 'dmg', arch: ['arm64', 'x64'] },
            { target: 'zip', arch: ['arm64', 'x64'] },
        ],
        icon,
        category: 'public.app-category.productivity',
        minimumSystemVersion: '13.0',
        hardenedRuntime: developerId,
        entitlements: 'resources/entitlements.mac.plist',
        entitlementsInherit: 'resources/entitlements.mac.plist',
        notarize,
        ...(developerId ? {} : { identity: '-' }),
        extendInfo: {
            NSMicrophoneUsageDescription: 'Rerun uses the microphone for voice notes and push to talk.',
            NSRequiresAquaSystemAppearance: false,
        },
    },
    dmg: {
        title: '${productName}',
        icon: null,
        artifactName: `${identity.executableName}-\${version}-mac-\${arch}.\${ext}`,
        writeUpdateInfo: false,
    },
    win: {
        target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
        icon,
        ...(azureSigning ? { azureSignOptions: azureSigning } : {}),
    },
    nsis: {
        oneClick: true,
        perMachine: false,
        buildUniversalInstaller: false,
        artifactName: `${identity.executableName}-\${version}-win-\${arch}.\${ext}`,
    },
    linux: {
        target: ['AppImage', 'deb', 'rpm'],
        icon,
        category: 'Office',
        executableName: identity.executableName,
        artifactName: `${identity.executableName}-\${version}-linux-\${arch}.\${ext}`,
        desktop: { entry: { StartupWMClass: identity.productName } },
    },
}

export default config
