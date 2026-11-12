'use client'

import { useEffect } from 'react'
import { isDesktopShell } from '@/lib/desktop-shell/client'

export function RegisterSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // The desktop app is already an installed app, and its offline page is its own: a worker would
    // only stand between the window and the network the app watches.
    if (isDesktopShell()) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => void registration.unregister()))
      return
    }
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  return null
}
