'use client'

import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useNotificationPrefs } from '@/hooks/useNotificationPrefs'
import { BellOff, CalendarClock, EllipsisIcon, SettingsIcon } from '@/lib/icons'
import type { CoworkerRule } from '@/lib/notifications/prefs'
import { useNotificationsStore } from '@/stores/notifications.store'

type InboxRowMenuProps = {
    agentId: string
    agentName: string
    onOpenChange: (open: boolean) => void
}

export function InboxRowMenu({ agentId, agentName, onOpenChange }: InboxRowMenuProps) {
    const t = useTranslations('notifications.inbox.rowMenu')
    const { ruleOf, setCoworkerRule } = useNotificationPrefs()
    const rule = ruleOf(agentId)

    const apply = (next: CoworkerRule, message: string) => {
        const previous = rule
        setCoworkerRule(agentId, next)
        toast(message, { action: { label: t('undo'), onClick: () => setCoworkerRule(agentId, previous) } })
    }

    return (
        <DropdownMenu onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t('options')} className="text-muted-foreground">
                    <EllipsisIcon />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                {rule.follow && (
                    <DropdownMenuItem onSelect={() => apply({ ...rule, follow: false }, t('unfollowed', { name: agentName }))}>
                        <CalendarClock />
                        {t('unfollow')}
                    </DropdownMenuItem>
                )}
                {rule.mode !== 'muted' && (
                    <DropdownMenuItem onSelect={() => apply({ ...rule, mode: 'muted' }, t('muted', { name: agentName }))}>
                        <BellOff />
                        <span className="truncate">{t('mute', { name: agentName })}</span>
                    </DropdownMenuItem>
                )}
                {(rule.follow || rule.mode !== 'muted') && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => useNotificationsStore.getState().openNotifications(agentId)}>
                    <SettingsIcon />
                    {t('settings')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
