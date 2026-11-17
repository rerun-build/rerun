'use client'

import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { Dialog } from '@/components/ui/dialog'

import { ComputersPanel } from './ComputersPanel'
import { useComputers } from './useComputers'

// The computers linked to the workspace. Like the Vault, they belong to the workspace and its one
// machine, never to a Box.
export function ComputersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const { list, error, reload } = useComputers(open)
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <PanelDialogContent className="sm:h-[min(44rem,90dvh)] sm:max-w-xl">
                <ComputersPanel list={list} error={error} onChanged={reload} />
            </PanelDialogContent>
        </Dialog>
    )
}
