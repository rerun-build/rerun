import 'server-only'

import { DESKTOP_SHELL_PLATFORMS, parseDesktopShellUserAgent, type DesktopShellIdentity, type DesktopShellPlatform } from '@rerun/contracts'
import { headers } from 'next/headers'
import { DESKTOP_SHELL_PREVIEW_HEADER } from './preview'

// The desktop app announces itself in its User-Agent, so the server renders the desktop chrome (the
// strip to drag the window by) from the first paint, before any script could read `window.rerunShell`.
// The lab of that chrome asks for it through the preview header instead.
export async function requestDesktopShell(): Promise<DesktopShellIdentity | null> {
    const requestHeaders = await headers()
    const preview = requestHeaders.get(DESKTOP_SHELL_PREVIEW_HEADER)
    if (preview && (DESKTOP_SHELL_PLATFORMS as readonly string[]).includes(preview)) return { version: '0.0.0', platform: preview as DesktopShellPlatform, channel: 'dev' }
    return parseDesktopShellUserAgent(requestHeaders.get('user-agent'))
}
