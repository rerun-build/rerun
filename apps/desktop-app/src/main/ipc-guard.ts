import { originOf, parseUrl } from './url-policy'

export type SenderAudience = 'app' | 'local'

export type SenderFrame = { url: string; isMainFrame: boolean } | null

// Every IPC handler answers only the main frame of a window showing the configured server (`app`) or
// one of the shell's own pages (`local`). A frame that navigated away or was destroyed is `null`, an
// iframe of any origin is refused, and so is a page the main window should never have shown.
export function senderAudience(frame: SenderFrame, serverOrigin: string | null, localOrigin: string): SenderAudience | null {
    if (!frame || !frame.isMainFrame) return null
    const url = parseUrl(frame.url)
    if (!url) return null
    const origin = originOf(url)
    if (origin === localOrigin) return 'local'
    if (serverOrigin && origin === serverOrigin) return 'app'
    return null
}
