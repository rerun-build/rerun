'use client'

import { useCallback, useEffect, useState } from 'react'
import { isDesktopShell } from '@/lib/desktop-shell/client'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    __pwaPrompt: BeforeInstallPromptEvent | null
  }
}

export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches || isDesktopShell()) return

    setCanInstall(!!window.__pwaPrompt)

    const onCanInstall = () => setCanInstall(true)
    const onInstalled = () => setCanInstall(false)

    window.addEventListener('pwa-can-install', onCanInstall)
    window.addEventListener('pwa-installed', onInstalled)
    return () => {
      window.removeEventListener('pwa-can-install', onCanInstall)
      window.removeEventListener('pwa-installed', onInstalled)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    const deferred = window.__pwaPrompt
    if (!deferred) return
    await deferred.prompt()
    window.__pwaPrompt = null
    setCanInstall(false)
  }, [])

  return { canInstall, promptInstall }
}
