'use client'

import { DetailBlock } from '@/components/connections/DetailBlock'
import { PlanLimitMeter } from '@/components/connections/SourceBits'
import { livePlanWindows, planWindowName, planWindowPercent, planWindowReset } from '@/lib/engine/ai-sources'
import type { BoxConnection } from '@/lib/engine/types'
import { shortRelativeTime } from '@/lib/time'
import { useLocale, useTranslations } from 'next-intl'

const MINUTE_MS = 60_000

function isUnderAMinuteOld(iso: string): boolean {
    return Date.now() - new Date(iso).getTime() < MINUTE_MS
}

// Where a subscription stands against its own plan: what the provider meters, not what Rerun bills.
export function PlanLimitsBlock({ connection }: { connection: Pick<BoxConnection, 'planLimits' | 'provider'> }) {
    const t = useTranslations('connections')
    const locale = useLocale()
    const windows = livePlanWindows(connection)

    if (!connection.planLimits || windows.length === 0) {
        return (
            <DetailBlock title={t('planLimits.title')}>
                <p className="text-[11px] text-muted-foreground">{t('planLimits.empty')}</p>
            </DetailBlock>
        )
    }

    const capturedAt = connection.planLimits.capturedAt
    const readingAge = isUnderAMinuteOld(capturedAt) ? t('planLimits.updatedJustNow') : t('planLimits.updatedAgo', { age: shortRelativeTime(capturedAt, locale) })

    return (
        <DetailBlock title={t('planLimits.title')} aside={<span className="text-[11px] text-muted-foreground">{readingAge}</span>}>
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                {windows.map(window => {
                    const name = planWindowName(window, t, connection.provider)
                    const reset = planWindowReset(window, t, locale)
                    const percent = planWindowPercent(window)
                    return (
                        <div key={`${window.kind}:${window.label ?? ''}`} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-3 text-xs">
                                <span className="font-medium">{name}</span>
                                <span className="text-muted-foreground tabular-nums">{reset ? t('planLimits.usedWithReset', { percent, reset }) : t('planLimits.used', { percent })}</span>
                            </div>
                            <PlanLimitMeter percent={window.usedPercent} label={t('meter.planLimit', { name })} />
                        </div>
                    )
                })}
            </div>
        </DetailBlock>
    )
}
