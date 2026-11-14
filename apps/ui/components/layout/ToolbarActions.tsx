'use client'

import { BillingDialog } from '@rerun/cloud/billing.client'
import { NotificationPermissionDialog } from '@/components/dialogs/NotificationPermissionDialog'
import { NotificationsDialog } from '@/components/dialogs/NotificationsDialog'
import { ShortcutsDialog } from '@/components/dialogs/ShortcutsDialog'
import { SubscriptionOfferDialog } from '@/components/dialogs/SubscriptionOfferDialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useInstallPrompt } from '@/components/pwa/useInstallPrompt'
import { selectHasEntries, selectUnreadCount, useChangelogStore } from '@/stores/changelog.store'
import { useForemanStore } from '@/stores/foreman.store'
import { useShortcutsStore } from '@/stores/shortcuts.store'
import { Badge } from '@rerun/ui/primitives'
import { BookOpenIcon, DownloadIcon, KeyboardIcon, ListTodoIcon, MegaphoneIcon, MonitorIcon, UsersIcon } from '@/lib/icons'
import { isDesktopShell } from '@/lib/desktop-shell/client'
import { detectMobileOs } from '@/lib/in-app-browser'
import { RERUN_CLOUD } from '@rerun/cloud/edition'
import { useSyncExternalStore } from 'react'
import { docsUrl, landingUrl } from '@/lib/site'
import { useTranslations } from 'next-intl'

export function WhatsNewMenuItem() {
    const t = useTranslations('layout.menu')
    const hasChangelog = useChangelogStore(selectHasEntries)
    const changelogUnread = useChangelogStore(selectUnreadCount)
    const openChangelog = useChangelogStore(s => s.openAll)

    if (!hasChangelog) return null

    return (
        <DropdownMenuItem onSelect={openChangelog} className="gap-2 text-muted-foreground whitespace-nowrap">
            <MegaphoneIcon className="size-4" />
            {t('whatsNew')}
            {changelogUnread > 0 && (
                <Badge size="xs" tone="brand" glow={false} className="ml-auto">
                    {changelogUnread}
                </Badge>
            )}
        </DropdownMenuItem>
    )
}

const noSubscription = () => () => {}

export function HelpMenuItems({ onOpenGettingStarted }: { onOpenGettingStarted: () => void }) {
    const t = useTranslations('layout.menu')
    const openShortcuts = useShortcutsStore(s => s.openShortcuts)
    const { canInstall, promptInstall } = useInstallPrompt()
    const gettingStartedAvailable = useForemanStore(s => s.gettingStartedAvailable)
    // Rerun Cloud publishes the desktop app; it is offered on a computer's browser, never inside it.
    const offerDesktopApp = useSyncExternalStore(noSubscription, () => RERUN_CLOUD && !isDesktopShell() && detectMobileOs(navigator.userAgent) === null, () => false)

    return (
        <>
            {gettingStartedAvailable && (
                <DropdownMenuItem
                    onSelect={() => {
                        onOpenGettingStarted()
                        useForemanStore.getState().openGettingStarted()
                    }}
                    className="gap-2 text-muted-foreground"
                >
                    <ListTodoIcon className="size-4" />
                    {t('gettingStarted')}
                </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild className="gap-2 text-muted-foreground">
                <a href={docsUrl()} target="_blank" rel="noopener noreferrer">
                    <BookOpenIcon className="size-4" />
                    {t('docs')}
                </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="gap-2 text-muted-foreground">
                <a href="https://discord.gg/cJUUgdTg5p" target="_blank" rel="noopener noreferrer">
                    <UsersIcon className="size-4" />
                    {t('community')}
                </a>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openShortcuts()} className="gap-2 text-muted-foreground">
                <KeyboardIcon className="size-4" />
                {t('shortcuts')}
            </DropdownMenuItem>
            {canInstall && (
                <DropdownMenuItem onSelect={promptInstall} className="gap-2 text-muted-foreground">
                    <DownloadIcon className="size-4" />
                    {t('installApp')}
                </DropdownMenuItem>
            )}
            {offerDesktopApp && (
                <DropdownMenuItem asChild className="gap-2 text-muted-foreground">
                    <a href={landingUrl('/download')} target="_blank" rel="noopener noreferrer">
                        <MonitorIcon className="size-4" />
                        {t('desktopApp')}
                    </a>
                </DropdownMenuItem>
            )}
        </>
    )
}

export function ToolbarDialogs() {
    return (
        <>
            <BillingDialog />
            <NotificationsDialog />
            <NotificationPermissionDialog />
            <SubscriptionOfferDialog />
            <ShortcutsDialog />
        </>
    )
}
