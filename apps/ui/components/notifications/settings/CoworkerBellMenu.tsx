'use client'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { CalendarClock, SettingsIcon } from '@/lib/icons'
import { COWORKER_MODES, type CoworkerMode, type CoworkerRule, type NotificationScope } from '@/lib/notifications/prefs'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { useRef } from 'react'

import { COWORKER_MODE_META } from './scope-meta'

type CoworkerBellMenuProps = {
    name: string
    rule: CoworkerRule
    scope: NotificationScope
    scheduledCount: number
    onChange: (rule: CoworkerRule) => void
    onOpenSettings: () => void
    open?: boolean
    onOpenChange?: (open: boolean) => void
    modal?: boolean
    align?: 'start' | 'end'
    className?: string
}

function ItemText({ label, hint }: { label: string; hint: string }) {
    return (
        <span className="flex min-w-0 flex-1 flex-col">
            <span>{label}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
        </span>
    )
}

// The glyph says the state at a glance: a plain bell follows your setting, a ringing one gets
// everything, a crossed one is muted, and the dot is a coworker whose scheduled tasks you follow.
export function CoworkerBellMenu({ name, rule, scope, scheduledCount, onChange, onOpenSettings, open, onOpenChange, modal, align = 'end', className }: CoworkerBellMenuProps) {
    const t = useTranslations('notifications.settings')
    const openingSettings = useRef(false)
    const ModeIcon = COWORKER_MODE_META[rule.mode].icon
    const following = rule.follow === true
    // Someone already following can always stop, whatever the count says.
    const noSchedule = scheduledCount === 0 && !following

    const hintOf = (mode: CoworkerMode) => (mode === 'default' ? t('modes.default.yourSetting', { scope: t(`scopes.${scope}.label`) }) : t(`modes.${mode}.hint`))

    return (
        <DropdownMenu open={open} onOpenChange={onOpenChange} modal={modal}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t('notificationsFor', { name })} className={cn('relative', rule.mode === 'muted' ? 'text-muted-foreground' : 'text-foreground', className)}>
                    <ModeIcon className="size-4" />
                    {following && rule.mode !== 'muted' && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align={align}
                className="w-72 max-w-[calc(100vw-1.5rem)]"
                onCloseAutoFocus={event => {
                    if (!openingSettings.current) return
                    openingSettings.current = false
                    event.preventDefault()
                }}
            >
                <DropdownMenuLabel className="truncate">{t('bell.title', { name })}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={rule.mode} onValueChange={mode => onChange({ ...rule, mode: mode as CoworkerMode })}>
                    {COWORKER_MODES.map(mode => {
                        const ItemIcon = COWORKER_MODE_META[mode].icon
                        return (
                            <DropdownMenuRadioItem key={mode} value={mode} className="items-start py-1.5">
                                <ItemIcon className="mt-0.5" />
                                <ItemText label={t(`modes.${mode}.label`)} hint={hintOf(mode)} />
                            </DropdownMenuRadioItem>
                        )
                    })}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <TooltipDisabledReason reason={noSchedule ? t('bell.noSchedule', { name }) : undefined} className="flex w-full">
                    <DropdownMenuCheckboxItem checked={following} disabled={noSchedule} onCheckedChange={checked => onChange({ ...rule, follow: checked === true })} className="w-full items-start py-1.5">
                        <CalendarClock className="mt-0.5" />
                        <ItemText label={t('bell.follow')} hint={noSchedule ? t('bell.nothingScheduled') : t('bell.scheduled', { count: scheduledCount })} />
                    </DropdownMenuCheckboxItem>
                </TooltipDisabledReason>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onSelect={() => {
                        openingSettings.current = true
                        onOpenSettings()
                    }}
                    className="py-1.5"
                >
                    <SettingsIcon />
                    {t('bell.allSettings')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
