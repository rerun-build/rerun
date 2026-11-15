import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { appPlatformOf } from '@/app/api/v1/_lib/client-platform'
import type { ClientConfig, ClientPlatform, ClientServer } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const MIN_BUILD_ENV: Record<ClientPlatform, string> = {
    ios: 'MOBILE_IOS_MIN_BUILD',
    android: 'MOBILE_ANDROID_MIN_BUILD',
}

function minBuildOf(platform: ClientPlatform): number {
    const build = Number.parseInt(process.env[MIN_BUILD_ENV[platform]] ?? '', 10)
    return Number.isInteger(build) && build > 0 ? build : 0
}

function hostnameReached(req: Request): string {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
    return host ? new URL(`http://${host.split(',')[0].trim()}`).hostname : new URL(req.url).hostname
}

function supabaseUrlSeenFrom(req: Request, supabaseUrl: string): string {
    const url = new URL(supabaseUrl)
    if (!LOOPBACK_HOSTS.has(url.hostname)) return supabaseUrl.replace(/\/+$/, '')
    url.hostname = hostnameReached(req)
    return url.origin
}

function serverOf(req: Request): ClientServer | undefined {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if (!supabaseUrl || !supabasePublishableKey) return undefined
    return { supabaseUrl: supabaseUrlSeenFrom(req, supabaseUrl), supabasePublishableKey }
}

export const GET = apiRoute({ auth: 'public' }, async ({ req }): Promise<ClientConfig> => ({ minBuild: minBuildOf(appPlatformOf(req)), server: serverOf(req) }))
