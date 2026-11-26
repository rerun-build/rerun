import { parseDesktopShellUserAgent } from '@rerun/contracts'

export type DeviceOs = 'macOS' | 'Windows' | 'Linux' | 'iOS' | 'Android' | 'ChromeOS'
export type DeviceBrowser = 'Chrome' | 'Safari' | 'Firefox' | 'Edge' | 'Opera' | 'Brave' | 'Arc'

// What "Where you're signed in" says of a session, from the user agent its sign-in came from.
export type SessionDevice =
    | { app: 'browser'; browser: DeviceBrowser | null; os: DeviceOs | null; phone: boolean }
    | { app: 'desktop'; os: DeviceOs | null }
    | { app: 'ios' }
    | { app: 'android' }
    | { app: 'unknown' }

const DESKTOP_PLATFORM_OS: Record<string, DeviceOs> = { mac: 'macOS', win: 'Windows', linux: 'Linux' }

function osOf(ua: string): DeviceOs | null {
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
    if (/Android/.test(ua)) return 'Android'
    if (/CrOS/.test(ua)) return 'ChromeOS'
    if (/Mac OS X|Macintosh/.test(ua)) return 'macOS'
    if (/Windows/.test(ua)) return 'Windows'
    if (/Linux/.test(ua)) return 'Linux'
    return null
}

// Order matters: every Chromium browser also says Chrome, and Chrome also says Safari.
function browserOf(ua: string): DeviceBrowser | null {
    if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge'
    if (/OPR\/|Opera/.test(ua)) return 'Opera'
    if (/Brave/.test(ua)) return 'Brave'
    if (/Arc\//.test(ua)) return 'Arc'
    if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox'
    if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome'
    if (/Safari\//.test(ua)) return 'Safari'
    return null
}

export function describeUserAgent(userAgent: string | null | undefined): SessionDevice {
    const ua = userAgent?.trim() ?? ''
    if (!ua) return { app: 'unknown' }
    const shell = parseDesktopShellUserAgent(ua)
    if (shell) return { app: 'desktop', os: DESKTOP_PLATFORM_OS[shell.platform] ?? null }
    if (/Electron\//.test(ua)) return { app: 'desktop', os: osOf(ua) }
    // The mobile app talks to the auth server with the platform's own HTTP stack.
    if (/CFNetwork\/.*Darwin\//.test(ua)) return { app: 'ios' }
    if (/^okhttp\//.test(ua)) return { app: 'android' }
    const browser = browserOf(ua)
    const os = osOf(ua)
    if (!browser && !os) return { app: 'unknown' }
    return { app: 'browser', browser, os, phone: os === 'iOS' || os === 'Android' }
}

export function callerUserAgent(headers: Headers): Record<string, string> {
    const userAgent = headers.get('user-agent')
    return userAgent ? { 'user-agent': userAgent } : {}
}
