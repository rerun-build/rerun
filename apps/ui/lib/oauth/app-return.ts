import { desktopShellScheme, type DesktopShellChannel } from '@rerun/contracts'

// Where an in-app sign-in ends: the iOS app, or the desktop app of a channel. A constant per app,
// never a URL the caller supplied: the callback routes redirect to it, so anything read from the
// request would be an open redirect. The desktop channel rides signed in the ticket and the grant.
export const APP_RETURN_URL = 'rerun://oauth/callback'

export function appReturnBase(desktop?: DesktopShellChannel): string {
    return desktop ? `${desktopShellScheme(desktop)}://oauth/callback` : APP_RETURN_URL
}

// `claim` names the row the callback parked the sign-in on; the app finishes with it, authenticated.
export function appReturnUrl(result: { ok: true; claim?: string } | { ok: false; error: string }, desktop?: DesktopShellChannel): string {
    const params = new URLSearchParams(result.ok ? { status: 'success', ...(result.claim ? { claim: result.claim } : {}) } : { status: 'error', message: result.error })
    return `${appReturnBase(desktop)}?${params.toString()}`
}
