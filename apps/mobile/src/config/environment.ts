import * as Updates from 'expo-updates'

import { readCustomServer, type CustomServer } from '@/config/custom-server'
import { PRODUCTION, STAGING } from '@moldwright/cloud-mobile/environments'

export type Environment = {
    name: 'production' | 'staging' | 'local' | 'custom'
    apiUrl: string
    supabaseUrl: string
    supabasePublishableKey: string
}

export function environmentForChannel(channel: string | null): Environment {
    if (channel === 'production') return PRODUCTION
    if (channel === 'staging') return STAGING

    return {
        name: 'local',
        apiUrl: process.env.EXPO_PUBLIC_API_URL ?? STAGING.apiUrl,
        supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? STAGING.supabaseUrl,
        supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? STAGING.supabasePublishableKey,
    }
}

export function environmentAtLaunch(channel: string | null, custom: CustomServer | null): Environment {
    if (custom) return { name: 'custom', ...custom }
    return environmentForChannel(channel)
}

export const environment = environmentAtLaunch(Updates.channel, readCustomServer())

export const onCustomServer = environment.name === 'custom'

export const webHost = onCustomServer ? new URL(environment.apiUrl).host : 'rerun.build'
