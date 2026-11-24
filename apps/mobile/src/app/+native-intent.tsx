import { isAuthCallback } from '@/lib/auth-callbacks'
import { holdShortcut } from '@/notifications/shortcut-link'

// On Android the browser hands an OAuth redirect back to the app as a deep link: the router must not
// open it as a screen. Nor a coworker's shortcut, which opens once the phone is in its workspace.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
    return isAuthCallback(path) || holdShortcut(path) ? null : path
}
