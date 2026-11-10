'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { RotateCwIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { restartWorkspaceEngineAction } from '@/app/api/_actions/space.actions'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useIsAdmin } from '@/hooks/useIsAdmin'

export type PowerAction = 'restart'

// The menu half. It only arms the confirmation: an AlertDialog rendered inside DropdownMenuContent
// is unmounted with the menu, so it would never get to open. The caller gates it on useIsAdmin too:
// a section that renders nothing still gets a separator from the menu that lays it out.
export function WorkspacePowerMenuItems({ onPick }: { onPick: (action: PowerAction) => void }) {
    const t = useTranslations('layout.power')
    const isAdmin = useIsAdmin()
    if (!isAdmin) return null

    return (
        <DropdownMenuItem onSelect={() => onPick('restart')} className="gap-2 text-muted-foreground">
            <RotateCwIcon className="size-4" />
            {t('menuItem')}
        </DropdownMenuItem>
    )
}

export function WorkspacePowerDialog({ action, onOpenChange }: { action: PowerAction | null; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('layout.power')
    const errorText = useErrorText()
    const isAdmin = useIsAdmin()
    const [isPending, startTransition] = useTransition()

    function run(next: PowerAction) {
        startTransition(async () => {
            const toastId = toast.loading(t(`${next}.pending`))
            try {
                const result = await restartWorkspaceEngineAction()
                if (result.ok) toast.success(t(`${next}.success`), { id: toastId })
                else toast.error(errorText(result), { id: toastId })
            } catch {
                toast.error(t('failed'), { id: toastId })
            }
        })
        onOpenChange(false)
    }

    if (!isAdmin) return null

    return (
        <AlertDialog open={action !== null} onOpenChange={onOpenChange}>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle>{action && t(`${action}.title`)}</AlertDialogTitle>
                    <AlertDialogDescription>{action && t(`${action}.description`)}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                        variant="destructive"
                        disabled={isPending}
                        onClick={() => {
                            if (action) run(action)
                        }}
                    >
                        {action && t(`${action}.confirmLabel`)}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
