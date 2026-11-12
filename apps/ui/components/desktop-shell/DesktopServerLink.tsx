'use client'

import { Button } from '@/components/ui/button'
import { desktopShell } from '@/lib/desktop-shell/client'
import { useTranslations } from 'next-intl'
import { useSyncExternalStore } from 'react'

const noSubscription = () => () => {}

// Under the sign-in methods of the desktop app: the way to a self-hosted server.
export function DesktopServerLink() {
    const t = useTranslations('desktopShell.server')
    const available = useSyncExternalStore(noSubscription, () => desktopShell('server') !== null, () => false)
    if (!available) return null
    return (
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => desktopShell('server')?.server.openPicker()}>
            {t('otherServer')}
        </Button>
    )
}
