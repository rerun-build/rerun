'use client'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Icon } from '@/components/ui/icon'
import { BellIcon } from '@/lib/icons'
import { requestBrowserPermission } from '@/lib/notifications/browser'
import { useNotificationsStore } from '@/stores/notifications.store'
import { Stripes } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

// Asked once, when the onboarding ends and there is an agent to hear from: a run can outlive the
// tab being looked at, and the browser permission is the only thing standing between a finished
// agent and the user hearing about it. Every way out marks the question answered, Escape included.
export function NotificationPermissionDialog() {
    const t = useTranslations('dialogs.notificationPermission')
    const open = useNotificationsStore(state => state.permissionPromptOpen)
    const answer = useNotificationsStore(state => state.answerPermission)

    return (
        <AlertDialog open={open} onOpenChange={next => !next && answer()}>
            {/* `sm:p-0` as well as `p-0`: the content keeps a separate `sm:p-4`, and a base padding
                reset leaves it standing, ringing the card with a stray gutter above 640px. */}
            <AlertDialogContent size="lg" className="gap-0 overflow-hidden p-0 sm:p-0">
                <div className="relative flex flex-col items-center gap-3 px-6 pt-8 pb-6 text-center">
                    <Stripes />
                    <Icon icon={BellIcon} className="relative" />
                    <div className="relative flex flex-col gap-1.5">
                        <AlertDialogTitle>{t('title')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('description')}</AlertDialogDescription>
                    </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-border px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
                    <AlertDialogAction
                        className="w-full"
                        onClick={async () => {
                            await requestBrowserPermission()
                            answer()
                        }}
                    >
                        {t('enable')}
                    </AlertDialogAction>
                    <AlertDialogCancel variant="ghost" className="w-full" onClick={answer}>
                        {t('later')}
                    </AlertDialogCancel>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    )
}
