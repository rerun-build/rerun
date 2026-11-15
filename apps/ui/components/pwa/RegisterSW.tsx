'use client'

import { useEffect } from 'react'
import { isDesktopShell } from '@/lib/desktop-shell/client'

export function RegisterSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (isDesktopShell()) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => void registration.unregister()))
      return
    }
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  return null
}
