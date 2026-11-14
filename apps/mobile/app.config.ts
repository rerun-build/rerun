import type { ConfigContext, ExpoConfig } from 'expo/config'

declare const require: (id: 'node:fs') => { existsSync(path: string): boolean; readFileSync(path: string, encoding: 'utf8'): string }
declare const __dirname: string
const { existsSync, readFileSync } = require('node:fs')

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

const RERUN_GOOGLE_SERVICES = process.env.GOOGLE_SERVICES_JSON ?? `${__dirname}/../../cloud/apps/mobile/google-services.json`

type GoogleServices = { client?: { client_info?: { android_client_info?: { package_name?: string } } }[] }

function googleServicesName(androidPackage: string | undefined): boolean {
    const { client = [] } = JSON.parse(readFileSync(RERUN_GOOGLE_SERVICES, 'utf8')) as GoogleServices
    return client.some(entry => entry.client_info?.android_client_info?.package_name === androidPackage)
}

function withGoogleServices(config: ConfigContext['config']): ConfigContext['config'] {
    if (!existsSync(RERUN_GOOGLE_SERVICES) || !googleServicesName(config.android?.package)) return config
    return { ...config, android: { ...config.android, googleServicesFile: RERUN_GOOGLE_SERVICES } }
}

const androidDevClient = process.env.RERUN_ANDROID_DEV_CLIENT === '1'

function withAndroidDevClient(config: ConfigContext['config']): ConfigContext['config'] {
    if (!androidDevClient) return config
    return { ...config, android: { ...config.android, package: `${config.android?.package}.dev` } }
}

const personalTeam = process.env.RERUN_PERSONAL_TEAM === '1'

const APP_LANGUAGES = ['en', 'fr', 'es', 'pt-BR', 'de'] as const

function withLanguages(config: ConfigContext['config']): ConfigContext['config'] {
    return {
        ...config,
        locales: Object.fromEntries(APP_LANGUAGES.map(language => [language, `./locales/${language}.json`])),
        ios: { ...config.ios, infoPlist: { ...config.ios?.infoPlist, CFBundleLocalizations: [...APP_LANGUAGES] } },
        plugins: [...(config.plugins ?? []), ['expo-localization', { supportedLocales: { android: [...APP_LANGUAGES] }, allowDynamicLocaleChangesAndroid: true }]],
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
        plugins: config.plugins?.filter(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) !== 'expo-notifications'),
        ios: {
            ...config.ios,
            bundleIdentifier: process.env.RERUN_IOS_BUNDLE_ID ?? `${config.ios?.bundleIdentifier}.dev`,
        },
    }
}
