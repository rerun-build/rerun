'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { DeleteAccountDialog } from '@/components/dialogs/DeleteAccountDialog'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { PanelRow } from '@/components/ui/panel-row'
import { SkeletonPanelRows } from '@/components/ui/skeleton'
import type { AccountDeletionBlocker } from '@/lib/auth/account-deletion'
import { CreditCard, LogOutIcon, Server, Users } from '@/lib/icons'

const CONSEQUENCES = [
    { icon: Users, key: 'shared' },
    { icon: Server, key: 'own' },
    { icon: LogOutIcon, key: 'signIn' },
] as const

export type DeleteAccountPanelProps = {
    // Null while the account is being checked.
    blockers: AccountDeletionBlocker[] | null
    // Billing opens on the workspace in hand, so only its own blocker gets the shortcut.
    currentWorkspaceId: number | null
    onOpenBilling: () => void
    // Throws with the message to show when the account could not be deleted.
    deleteAccount: (confirmation: string) => Promise<void>
}

export function DeleteAccountPanel({ blockers, currentWorkspaceId, onOpenBilling, deleteAccount }: DeleteAccountPanelProps) {
    const t = useTranslations('account.delete')
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [pending, setPending] = useState(false)

    if (!blockers) {
        return (
            <div className="px-1 py-2 sm:px-3">
                <SkeletonPanelRows rows={3} lines={2} leading />
            </div>
        )
    }

    const confirm = async (confirmation: string) => {
        setPending(true)
        try {
            await deleteAccount(confirmation)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('failed'))
            setPending(false)
            setConfirmOpen(false)
        }
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-5 sm:px-6">
                {CONSEQUENCES.map(consequence => (
                    <PanelRow key={consequence.key} leading={<Icon icon={consequence.icon} size="sm" />} title={t(`consequences.${consequence.key}.title`)} description={t(`consequences.${consequence.key}.description`)} />
                ))}

                {blockers.map(blocker => (
                    <PanelRow
                        key={blocker.workspaceId}
                        leading={<Icon icon={CreditCard} size="sm" />}
                        title={blocker.name}
                        description={blocker.billedBy && blocker.billedBy !== 'stripe' ? t('blocker.store', { store: blocker.billedBy }) : blocker.workspaceId === currentWorkspaceId ? t('blocker.current') : t('blocker.other')}
                        actions={
                            blocker.workspaceId === currentWorkspaceId &&
                            (!blocker.billedBy || blocker.billedBy === 'stripe') && (
                                <Button type="button" variant="outline" size="sm" onClick={onOpenBilling}>
                                    {t('blocker.openBilling')}
                                </Button>
                            )
                        }
                    />
                ))}
            </div>

            <div className="flex justify-end border-t px-4 py-3 max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6">
                <Button type="button" variant="destructive" disabled={blockers.length > 0} onClick={() => setConfirmOpen(true)}>
                    {t('submit')}
                </Button>
            </div>

            <DeleteAccountDialog open={confirmOpen} pending={pending} onOpenChange={setConfirmOpen} onConfirm={confirmation => void confirm(confirmation)} />
        </div>
    )
}
