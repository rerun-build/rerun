import type { ConfigContext, ExpoConfig } from 'expo/config'

// Expo evaluates this file in Node, but the app's TypeScript program has no Node types: the two
// Node calls it makes are declared here rather than pulling Node's globals into the whole app.
declare const require: (id: 'node:fs') => { existsSync(path: string): boolean; readFileSync(path: string, encoding: 'utf8'): string }
declare const __dirname: string
const { existsSync, readFileSync } = require('node:fs')

// The EAS project the app builds and updates through. Rerun's sits in the private cloud/ folder; a
// fork names its own with EXPO_OWNER and EAS_PROJECT_ID, or runs without one in development.
const RERUN_EAS = `${__dirname}/../../cloud/apps/mobile/expo.private.json`

function easProject(): { owner?: string; projectId?: string } {
    if (existsSync(RERUN_EAS)) return JSON.parse(readFileSync(RERUN_EAS, 'utf8')) as { owner: string; projectId: string }
    return { owner: process.env.EXPO_OWNER, projectId: process.env.EAS_PROJECT_ID }
}

function withEasProject(config: ConfigContext['config']): ConfigContext['config'] {
    const { owner, projectId } = easProject()
    if (!projectId) return config
    return { ...config, owner, extra: { ...config.extra, eas: { ...config.extra?.eas, projectId } }, updates: { ...config.updates, url: `https://u.expo.dev/${projectId}` } }
}

// The builder never receives cloud/, so a store build without it reads its hub from EXPO_PUBLIC_* (see
// src/cloud-oss/environments.ts). Missing, the app ships pointing at localhost with an empty Supabase
// key and crashes on launch: fail the build instead.
const RERUN_CLOUD_SOURCE = `${__dirname}/../../cloud/apps/mobile/src/environments.ts`
const STORE_PROFILES = ['production', 'staging']
const REQUIRED_HUB_VARIABLES = ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] as const

function assertStoreBuildHasHub(): void {
    if (process.env.EAS_BUILD !== 'true' || !STORE_PROFILES.includes(process.env.EAS_BUILD_PROFILE ?? '')) return
    if (existsSync(RERUN_CLOUD_SOURCE)) return
    const missing = REQUIRED_HUB_VARIABLES.filter(name => !process.env[name])
    if (missing.length === 0) return
    throw new Error(`Store build "${process.env.EAS_BUILD_PROFILE}" has no hub to point at: set ${missing.join(', ')} in its EAS environment.`)
}

// Firebase's file for Android push, Rerun's in the private cloud/ folder. Without it the app builds and
// runs on Android, it just never gets a push token (the same as iOS without an EAS project). The Google
// Services Gradle plugin refuses a file that does not name the app's package, so a build whose package
// the file does not list (the development client, until it is declared in the Firebase project) goes
// without it too.
const RERUN_GOOGLE_SERVICES = `${__dirname}/../../cloud/apps/mobile/google-services.json`

type GoogleServices = { client?: { client_info?: { android_client_info?: { package_name?: string } } }[] }

function googleServicesName(androidPackage: string | undefined): boolean {
    const { client = [] } = JSON.parse(readFileSync(RERUN_GOOGLE_SERVICES, 'utf8')) as GoogleServices
    return client.some(entry => entry.client_info?.android_client_info?.package_name === androidPackage)
}

function withGoogleServices(config: ConfigContext['config']): ConfigContext['config'] {
    if (!existsSync(RERUN_GOOGLE_SERVICES) || !googleServicesName(config.android?.package)) return config
    return { ...config, android: { ...config.android, googleServicesFile: RERUN_GOOGLE_SERVICES } }
}

// The Android development client installs beside the store app, as `build.rerun.app.dev`.
const androidDevClient = process.env.RERUN_ANDROID_DEV_CLIENT === '1'

function withAndroidDevClient(config: ConfigContext['config']): ConfigContext['config'] {
    if (!androidDevClient) return config
    return { ...config, android: { ...config.android, package: `${config.android?.package}.dev` } }
}

// A free Apple ID (personal team) cannot claim a bundle ID some other team may own. Local dev builds
// set RERUN_PERSONAL_TEAM=1 so they install on a real iPhone without a paid Apple Developer account.
// Store builds leave it unset. Such a team cannot sign the push capability either, so its builds leave
// the notifications plugin out: the app runs, it just never gets a push token.
const personalTeam = process.env.RERUN_PERSONAL_TEAM === '1'

// The languages iOS offers in the app's own settings, and the permission prompts in each of them. The
// English prompts of app.json stay the default for any other language.
const APP_LANGUAGES = ['en', 'fr', 'es', 'pt-BR', 'de'] as const

function withLanguages(config: ConfigContext['config']): ConfigContext['config'] {
    return {
        ...config,
        locales: Object.fromEntries(APP_LANGUAGES.map(language => [language, `./locales/${language}.json`])),
        ios: { ...config.ios, infoPlist: { ...config.ios?.infoPlist, CFBundleLocalizations: [...APP_LANGUAGES] } },
    }
}

export default ({ config: base }: ConfigContext): ExpoConfig => {
    assertStoreBuildHasHub()
    const config = withGoogleServices(withAndroidDevClient(withLanguages(withEasProject(base))))
    if (!personalTeam) return config as ExpoConfig

    return {
        ...config,
        name: config.name!,
        slug: config.slug!,
        plugins: config.plugins?.filter(plugin => plugin !== 'expo-notifications'),
        ios: {
            ...config.ios,
            bundleIdentifier: process.env.RERUN_IOS_BUNDLE_ID ?? `${config.ios?.bundleIdentifier}.dev`,
        },
    }
}
