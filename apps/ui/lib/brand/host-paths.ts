import { DESKTOP_AUTH_PATH } from '@rerun/contracts'
import { REFERRAL_PATH } from '@/ee/lib/billing/referral'
import { routes } from '@/lib/routes'

// What belongs to Rerun's own address: its sign-in with Google, Apple and the desktop app, its codes,
// its programs and its labs, and what the engine, the providers and the phone call there. On an
// organization's address they do not exist.
const RERUN_ONLY_PATHS = [routes.authCallback, DESKTOP_AUTH_PATH, REFERRAL_PATH, '/welcome', '/redeem', '/creator', '/render', '/experts', '/quick-ask', '/coworker-dock', '/api/oauth/mobile', '/api/oauth/host', '/api/webhooks', '/api/engines', '/api/edge']

export function isRerunOnlyPath(pathname: string): boolean {
    return RERUN_ONLY_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`))
}

export const HOST_UNAVAILABLE_ROUTE = '/host-unavailable'

// On the sign-in of an organization's default address: they were sent there from a domain of its own.
export const MOVED_PARAM = 'moved'
