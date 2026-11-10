'use client'

import { Button, Icon, ScrollFade, Stripes } from '../primitives'
import { cn } from '../cn'
import { BellIcon } from '../icons'
import { TooltipLabeled } from '../Tooltip'
import { fullDateTime, shortRelativeTime } from '../time'
import { useKitTranslations, useUiLocale } from '../locale'
import type { ReactNode } from 'react'

export type AlertBlockProps = {
    message: string
    onAcknowledge: () => void
    at?: string | null
    pending?: boolean
    renderText?: (text: string) => ReactNode
    className?: string
}

export function AlertBlock({ message, onAcknowledge, at, pending, renderText = text => text, className }: AlertBlockProps) {
    const locale = useUiLocale()
    const t = useKitTranslations()
    const raisedAt = at && !Number.isNaN(new Date(at).getTime()) ? at : null

    return (
        <div className={cn('relative mb-2 overflow-hidden rounded-lg border border-border bg-card p-3', className)}>
            <Stripes fade="bottom" />
            <div className="relative space-y-2.5">
                <div className="flex items-center gap-2.5">
                    <Icon size="sm" icon={BellIcon} />
                    <p className="text-sm leading-snug font-medium">{t('chat.alert.title')}</p>
                    {raisedAt && (
                        <TooltipLabeled label={fullDateTime(raisedAt, locale)}>
                            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">{shortRelativeTime(raisedAt, locale)}</span>
                        </TooltipLabeled>
                    )}
                </div>
                <ScrollFade className="max-h-[22vh] text-sm">{renderText(message)}</ScrollFade>
                <div className="flex items-center justify-end">
                    <Button size="sm" loading={pending} onClick={onAcknowledge} data-hitl="acknowledge">
                        {t('chat.alert.markAsRead')}
                    </Button>
                </div>
            </div>
        </div>
    )
}
