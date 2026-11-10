'use client'

import { AiProvidersPanel, type InitialConnection } from '@/components/connections/AiProvidersPanel'
import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import type { Provider } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

// Provider credentials belong to the workspace, not to a Box: one machine runs every agent on the
// board, and it reads them from a single folder of its data dir.
export function AiProvidersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('dialogs.aiProviders')
    const focus = useWorkspaceSettingsStore(s => s.focus)
    const clearFocus = useWorkspaceSettingsStore(s => s.clearFocus)
    // The signal is cleared as soon as it is read, but the panel it asks for only mounts on the
    // next render, so what it carried is held here until that panel picks it up.
    const [initialConnection, setInitialConnection] = useState<InitialConnection | null>(null)
    const [initialAddProvider, setInitialAddProvider] = useState<Exclude<Provider, 'rerun'> | null>(null)

    useEffect(() => {
        if (!focus?.connectionId && !focus?.addProvider) return
        /* eslint-disable react-hooks/set-state-in-effect */
        if (focus.connectionId) setInitialConnection({ connectionId: focus.connectionId, reconnect: focus.reconnect ?? false })
        if (focus.addProvider) setInitialAddProvider(focus.addProvider)
        /* eslint-enable react-hooks/set-state-in-effect */
        clearFocus()
    }, [focus, clearFocus])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <PanelDialogContent className="sm:h-[min(48rem,90dvh)] sm:max-w-2xl">
                <DialogHeader className="border-b px-4 py-4">
                    <DialogTitle>{t('title')}</DialogTitle>
                    <DialogDescription>{t('description')}</DialogDescription>
                </DialogHeader>

                <div className="flex min-h-0 flex-1 flex-col">
                    <AiProvidersPanel
                        initialConnection={initialConnection}
                        onInitialConnectionConsumed={() => setInitialConnection(null)}
                        initialAddProvider={initialAddProvider}
                        onInitialAddProviderConsumed={() => setInitialAddProvider(null)}
                    />
                </div>
            </PanelDialogContent>
        </Dialog>
    )
}
