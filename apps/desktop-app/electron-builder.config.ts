import type { Configuration } from 'electron-builder'
import { desktopShellScheme } from '@rerun/contracts'
import { buildSettings } from './build-config'

// Packaging of the three apps (Rerun, Rerun Staging, Rerun Dev), one per `RERUN_DESKTOP_CHANNEL`,
// each with its own id, name, icon, URL scheme, data folder and update feed:
//
//   RERUN_DESKTOP_CHANNEL=stable RERUN_DESKTOP_DEFAULT_URL=https://app.rerun.build pnpm package
//
// Signing and notarization switch on with their credentials, as in the release workflow:
//   macOS     CSC_LINK + CSC_KEY_PASSWORD (Developer ID Application), APPLE_API_KEY + APPLE_API_KEY_ID
//             + APPLE_API_ISSUER (App Store Connect key) for the notarization
//   Windows   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET + RERUN_AZURE_SIGNING_* (Artifact Signing)
// Without them the build is signed ad hoc and not notarized, which is what CI and a build from the
// sources make.
//
// RERUN_DESKTOP_E2E=1 keeps the inspector fuse on: Playwright cannot drive the app without it. Such a
// build is for tests only and is never published.

const settings = buildSettings()
const channel = settings.channel
const e2e = process.env.RERUN_DESKTOP_E2E === '1'

const IDENTITIES = {
    stable: { appId: 'build.rerun.desktop', productName: 'Rerun', executableName: 'rerun' },
    staging: { appId: 'build.rerun.desktop.staging', productName: 'Rerun Staging', executableName: 'rerun-staging' },
    dev: { appId: 'build.rerun.desktop.dev', productName: 'Rerun Dev', executableName: 'rerun-dev' },
} as const

const identity = IDENTITIES[channel]
const icon = `resources/icons/${channel}/icon.png`
const updateFeed = process.env.RERUN_DESKTOP_UPDATE_URL ?? `https://downloads.rerun.build/desktop/${channel}`
// Without a Developer ID (CI, a build from the sources) the app is signed ad hoc: Apple Silicon refuses
// to run a binary whose signature the fuses broke, and an ad hoc one runs on the machine that built it.
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
    // Only the updater is a runtime dependency; everything else is bundled by electron-vite.
    npmRebuild: false,
    protocols: [{ name: identity.productName, schemes: [desktopShellScheme(channel)] }],
    publish: [{ provider: 'generic', url: updateFeed }],
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
            { target: 'dmg', arch: ['universal'] },
            // The zip is what the updater downloads; without it no latest-mac.yml is written.
            { target: 'zip', arch: ['universal'] },
        ],
        icon,
        category: 'public.app-category.productivity',
        minimumSystemVersion: '13.0',
        // The hardened runtime is what notarization asks for. An ad hoc build leaves it off: under it, each
        // framework would have to carry the same Team ID as the app, which an ad hoc signature has not.
        hardenedRuntime: developerId,
        entitlements: 'resources/entitlements.mac.plist',
        entitlementsInherit: 'resources/entitlements.mac.plist',
        notarize,
        ...(developerId ? {} : { identity: '-' }),
        extendInfo: {
            NSMicrophoneUsageDescription: 'Rerun uses the microphone for voice notes and push to talk.',
            // The window takes the system's appearance before the page loads.
            NSRequiresAquaSystemAppearance: false,
        },
    },
    dmg: {
        artifactName: `${identity.executableName}-\${version}-mac.\${ext}`,
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
