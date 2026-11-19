import { CLIENT_HEADER, parseClientHeader, type ClientIdentity, type ClientPlatform } from '@moldwright/contracts'

export function clientOf(req: Request): ClientIdentity | null {
    return parseClientHeader(req.headers.get(CLIENT_HEADER))
}

export function appPlatformOf(req: Request): ClientPlatform {
    return clientOf(req)?.platform ?? 'ios'
}
