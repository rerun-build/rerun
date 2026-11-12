'use client'

import type { DesktopSignInProvider } from '@rerun/contracts'
import { useSyncExternalStore } from 'react'
import { desktopShell } from '@/lib/desktop-shell/client'

// Inside the desktop app, Google and Apple sign in through the system browser. The button that
// starts it and the sign-in page that then waits for the browser share this small state.
let waitingFor: DesktopSignInProvider | null = null
const listeners = new Set<() => void>()

function emit(next: DesktopSignInProvider | null) {
    waitingFor = next
    listeners.forEach((listener) => listener())
}

export function desktopBrowserSignInAvailable(): boolean {
    return desktopShell('auth') !== null
}

export async function startDesktopBrowserSignIn(provider: DesktopSignInProvider): Promise<void> {
    const shell = desktopShell('auth')
    if (!shell) return
    emit(provider)
    await shell.auth.startBrowserSignIn({ provider })
}

export function stopWaitingForBrowser(): void {
    emit(null)
}

export function useDesktopSignInWaiting(): DesktopSignInProvider | null {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        () => waitingFor,
        () => null,
    )
}
