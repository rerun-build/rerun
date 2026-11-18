'use client'

import { modelName, planName } from '@/lib/engine/ai-sources'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { ArrowRightIcon } from '@/lib/icons'
import type { ProviderSwitch } from '@rerun/contracts'
import { calendarDaysBetween, messageTime, shortDate } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

// Where the conversation moved to a backup model because a plan hit its limit, and where it came
// back: a quiet line across the thread, not a notice, since nothing is asked of the user.
export function ProviderSwitchDivider({ change }: { change: ProviderSwitch }) {
    const t = useTranslations('chat.providerSwitch')
    const locale = useLocale()
    const [now] = useState(() => Date.now())
    const model = modelName(change.to.connectionId, change.to.model)

    const text = (() => {
        if (change.kind === 'back') return t('back', { plan: planName(change.to), model })
        const plan = planName(change.from)
        if (!change.resetsAt || Date.parse(change.resetsAt) <= now) return t('limit', { plan, model })
        const time = messageTime(change.resetsAt, locale)
        return calendarDaysBetween(new Date(now), new Date(change.resetsAt)) === 0 ? t('limitUntil', { plan, model, time }) : t('limitUntilDate', { plan, model, time, date: shortDate(change.resetsAt, locale) })
    })()

    return (
        <div className="flex w-full items-center gap-3 py-1">
            <span aria-hidden className="h-px flex-1 bg-border" />
            <span className="flex max-w-[80%] items-center gap-2 text-xs text-muted-foreground">
                <span aria-hidden className="flex shrink-0 items-center gap-1">
                    <ProviderIcon provider={change.from.provider} className="size-3.5" />
                    <ArrowRightIcon className="size-3" />
                    <ProviderIcon provider={change.to.provider} className="size-3.5" />
                </span>
                <span>{text}</span>
            </span>
            <span aria-hidden className="h-px flex-1 bg-border" />
        </div>
    )
}
