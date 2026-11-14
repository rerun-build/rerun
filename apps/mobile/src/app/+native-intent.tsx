import { isAuthCallback } from '@/lib/auth-callbacks'

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
    return isAuthCallback(path) ? null : path
}
