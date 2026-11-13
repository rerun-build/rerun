'use client'

import { useTranslations } from 'next-intl'

import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useVault } from './useVault'
import { VaultPanel } from './VaultPanel'

// The accounts and keys the workspace's coworkers share. Like the AI providers, they belong to the
// workspace and its one machine, never to a Box.
export function VaultDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('vault')
    const { listing, error, reload } = useVault(open)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <PanelDialogContent className="sm:h-[min(48rem,90dvh)] sm:max-w-2xl">
                <DialogHeader className="border-b px-4 py-4">
                    <DialogTitle>{t('title')}</DialogTitle>
                    <DialogDescription>{t('description')}</DialogDescription>
                </DialogHeader>
                <div className="flex min-h-0 flex-1 flex-col">
                    <VaultPanel listing={listing} error={error} onChanged={reload} />
                </div>
            </PanelDialogContent>
        </Dialog>
    )
}
