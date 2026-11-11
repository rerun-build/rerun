import { isAuthCallback } from '@/lib/auth-callbacks'

// On Android the browser hands an OAuth redirect back to the app as a deep link: the router must not
// open it as a screen.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
    return isAuthCallback(path) ? null : path
}
