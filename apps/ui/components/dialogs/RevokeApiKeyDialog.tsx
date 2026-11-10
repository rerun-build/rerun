'use client'

import type { ApiKeyView } from '@/app/api/_actions/api-keys.actions'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Loader2Icon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

export function RevokeApiKeyDialog({ apiKey, pending, onOpenChange, onConfirm }: { apiKey: ApiKeyView | null; pending: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
    const t = useTranslations('dialogs.apiKeys.revoke')
    const tCommon = useTranslations('common')
    return (
        <AlertDialog open={!!apiKey} onOpenChange={onOpenChange}>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle>{t('title')}</AlertDialogTitle>
                    <AlertDialogDescription>{apiKey?.name ? t('description', { name: apiKey.name }) : t('descriptionUnnamed')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>{tCommon('cancel')}</AlertDialogCancel>
                    {/* preventDefault keeps the confirm open with a spinner; the parent closes it once the
                        action lands, which also avoids body pointer-events sticking on unmount. */}
                    <AlertDialogAction
                        variant="destructive"
                        disabled={pending}
                        onClick={event => {
                            event.preventDefault()
                            onConfirm()
                        }}
                    >
                        {pending && <Loader2Icon className="animate-spin" />}
                        {t('confirm')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
