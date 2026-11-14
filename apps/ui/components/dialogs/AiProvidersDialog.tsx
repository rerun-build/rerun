'use client'

import { AiProvidersPanel, type InitialConnection } from '@/components/connections/AiProvidersPanel'
import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import type { Provider } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

export function AiProvidersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('dialogs.aiProviders')
    const focus = useWorkspaceSettingsStore(s => s.focus)
    const clearFocus = useWorkspaceSettingsStore(s => s.clearFocus)
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
