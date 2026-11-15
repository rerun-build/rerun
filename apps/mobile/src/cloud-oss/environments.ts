import type { Environment } from '@/config/environment'

function hubOf(name: Environment['name']): Environment {
    return {
        name,
        apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
        supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54421',
        supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    }
}

export const PRODUCTION = hubOf('production')
export const STAGING = hubOf('staging')

export const POSTHOG_TOKEN = process.env.EXPO_PUBLIC_POSTHOG_TOKEN ?? ''
