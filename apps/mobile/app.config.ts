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

// A free Apple ID (personal team) cannot claim a bundle ID some other team may own. Local dev builds
// set RERUN_PERSONAL_TEAM=1 so they install on a real iPhone without a paid Apple Developer account.
// Store builds leave it unset. Such a team cannot sign the push capability either, so its builds leave
// the notifications plugin out: the app runs, it just never gets a push token.
const personalTeam = process.env.RERUN_PERSONAL_TEAM === '1'

// The languages iOS offers in the app's own settings, and the permission prompts in each of them. The
// English prompts of app.json stay the default for any other language.
const APP_LANGUAGES = ['en', 'fr', 'es'] as const

function withLanguages(config: ConfigContext['config']): ConfigContext['config'] {
    return {
        ...config,
        locales: Object.fromEntries(APP_LANGUAGES.map(language => [language, `./locales/${language}.json`])),
        ios: { ...config.ios, infoPlist: { ...config.ios?.infoPlist, CFBundleLocalizations: [...APP_LANGUAGES] } },
    }
}

export default ({ config: base }: ConfigContext): ExpoConfig => {
    const config = withLanguages(withEasProject(base))
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
