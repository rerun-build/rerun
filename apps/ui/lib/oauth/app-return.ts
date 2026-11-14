import { desktopShellScheme, type DesktopShellChannel } from '@rerun/contracts'

export const APP_RETURN_URL = 'rerun://oauth/callback'

export function appReturnBase(desktop?: DesktopShellChannel): string {
    return desktop ? `${desktopShellScheme(desktop)}://oauth/callback` : APP_RETURN_URL
}

export function appReturnUrl(result: { ok: true; claim?: string } | { ok: false; error: string }, desktop?: DesktopShellChannel): string {
    const params = new URLSearchParams(result.ok ? { status: 'success', ...(result.claim ? { claim: result.claim } : {}) } : { status: 'error', message: result.error })
    return `${appReturnBase(desktop)}?${params.toString()}`
}
