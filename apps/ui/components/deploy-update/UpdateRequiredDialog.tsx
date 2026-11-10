'use client'

import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Icon } from '@/components/ui/icon'
import { RocketIcon } from '@/lib/icons'
import { Stripes } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

// Controlled without onOpenChange: Escape and outside clicks cannot close it, Reload is the only way out.
export function UpdateRequiredDialog({ open }: { open: boolean }) {
    const t = useTranslations('layout.update')
    return (
        <AlertDialog open={open}>
            {/* `sm:p-0` as well as `p-0`: the content keeps a separate `sm:p-4`, and a base padding
                reset leaves it standing, ringing the card with a stray gutter above 640px. */}
            <AlertDialogContent size="lg" className="gap-0 overflow-hidden p-0 sm:p-0">
                <div className="relative flex flex-col items-center gap-3 px-6 pt-8 pb-6 text-center">
                    <Stripes />
                    <Icon icon={RocketIcon} className="relative" />
                    <div className="relative flex flex-col gap-1.5">
                        <AlertDialogTitle>{t('required.title')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('required.description')}</AlertDialogDescription>
                    </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-border px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
                    <AlertDialogAction className="w-full" onClick={() => window.location.reload()}>
                        {t('reload')}
                    </AlertDialogAction>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    )
}
