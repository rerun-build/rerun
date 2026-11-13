'use client'

import { SUPPORT_CHAT_ENABLED } from '@rerun/cloud/support'
import { ChromePill } from '@rerun/ui/chrome'
import { HelpMenuItems } from '@/components/layout/ToolbarActions'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { HeadsetIcon, HelpCircleIcon } from '@/lib/icons'
import { openCrisp } from '@/lib/crisp'
import { useSession } from '@/supabase/session/SessionProvider'
import { useTranslations } from 'next-intl'
import { useRef } from 'react'

// `icon`: a plain icon button, for a row of icon buttons such as the foot of the Simple view's list.
export function HelpButton({ trigger = 'chrome' }: { trigger?: 'chrome' | 'icon' }) {
    const t = useTranslations('layout.help')
    const { session } = useSession()
    // The menu hands focus back to its trigger as it closes, which the checklist popover would read
    // as a click outside and close on the spot.
    const openingGettingStarted = useRef(false)

    return (
        <DropdownMenu>
            <TooltipLabeled label={t('label')} side="bottom">
                <DropdownMenuTrigger asChild>
                    {trigger === 'icon' ? (
                        <Button variant="ghost" size="icon-sm" aria-label={t('label')}>
                            <HelpCircleIcon className="size-4" />
                        </Button>
                    ) : (
                        <ChromePill start="icon" end="icon" aria-label={t('label')}>
                            <HelpCircleIcon className="size-4 text-muted-foreground" />
                        </ChromePill>
                    )}
                </DropdownMenuTrigger>
            </TooltipLabeled>
            <DropdownMenuContent
                align="start"
                side="bottom"
                className="w-56 max-h-[calc(100dvh-5rem)] overflow-y-auto"
                onCloseAutoFocus={event => {
                    if (!openingGettingStarted.current) return
                    openingGettingStarted.current = false
                    event.preventDefault()
                }}
            >
                {SUPPORT_CHAT_ENABLED && (
                    <>
                        <DropdownMenuItem onSelect={() => openCrisp(session?.user?.email)} className="gap-2 text-muted-foreground">
                            <HeadsetIcon className="size-4" />
                            {t('contactSupport')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                )}
                <HelpMenuItems
                    onOpenGettingStarted={() => {
                        openingGettingStarted.current = true
                    }}
                />
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
