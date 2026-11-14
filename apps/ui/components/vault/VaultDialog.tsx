'use client'

import { useTranslations } from 'next-intl'

import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { Dialog } from '@/components/ui/dialog'
import { LockKeyholeIcon } from '@/lib/icons'
import { useVault } from './useVault'
import { VaultPanel } from './VaultPanel'

// The accounts and keys the workspace's coworkers share. Like the AI providers, they belong to the
// workspace and its one machine, never to a Box.
export function VaultDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('vault')
    const { listing, paid, error, reload } = useVault(open)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <PanelDialogContent className="sm:h-[min(48rem,90dvh)] sm:max-w-2xl">
                <DialogHeaderBar icon={LockKeyholeIcon} title={t('title')} description={t('description')} />
                <div className="flex min-h-0 flex-1 flex-col">
                    <VaultPanel listing={listing} paid={paid} error={error} onChanged={reload} />
                </div>
            </PanelDialogContent>
        </Dialog>
    )
}
