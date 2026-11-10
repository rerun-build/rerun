import { CLIENT_HEADER, parseClientHeader, type ClientIdentity, type ClientPlatform } from '@rerun/contracts'

export function clientOf(req: Request): ClientIdentity | null {
    return parseClientHeader(req.headers.get(CLIENT_HEADER))
}

// Only the mobile app calls /api/v1, and the iOS builds from before the header send none.
export function appPlatformOf(req: Request): ClientPlatform {
    return clientOf(req)?.platform ?? 'ios'
}
