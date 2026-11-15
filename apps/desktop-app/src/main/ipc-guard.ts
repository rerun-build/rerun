import { originOf, parseUrl } from './url-policy'

export type SenderAudience = 'app' | 'local'

export type SenderFrame = { url: string; isMainFrame: boolean } | null

export function senderAudience(frame: SenderFrame, serverOrigin: string | null, localOrigin: string): SenderAudience | null {
    if (!frame || !frame.isMainFrame) return null
    const url = parseUrl(frame.url)
    if (!url) return null
    const origin = originOf(url)
    if (origin === localOrigin) return 'local'
    if (serverOrigin && origin === serverOrigin) return 'app'
    return null
}
