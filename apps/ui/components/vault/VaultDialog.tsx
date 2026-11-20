'use client'

import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { Dialog } from '@/components/ui/dialog'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { useVault } from './useVault'
import { VaultPanel } from './VaultPanel'

// The accounts and keys the workspace's coworkers share. Like the AI providers, they belong to the
// workspace and its one machine, never to a Box.
export function VaultDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const { listing, paid, error, reload } = useVault(open)
    // An entry the Chief of Staff opened the Vault on: the panel starts over on it.
    const entryId = useWorkspaceSettingsStore(state => state.focus?.entryId)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* The dialog hears Escape on the document before the field renaming an account does: there,
                it cancels the rename and leaves the Vault open. */}
            <PanelDialogContent className="sm:h-[min(48rem,90dvh)] sm:max-w-2xl" onEscapeKeyDown={event => event.target instanceof HTMLElement && event.target.closest('[data-vault-account-name]') && event.preventDefault()}>
                <VaultPanel key={entryId ?? 'list'} initialEntryId={entryId} listing={listing} paid={paid} error={error} onChanged={reload} />
            </PanelDialogContent>
        </Dialog>
    )
}
