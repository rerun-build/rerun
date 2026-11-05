'use client'

import { DetailBlock } from '@/components/connections/DetailBlock'
import { PlanLimitMeter } from '@/components/connections/SourceBits'
import { livePlanWindows, planWindowName, planWindowPercent, planWindowReset } from '@/lib/engine/ai-sources'
import type { BoxConnection } from '@/lib/engine/types'
import { shortRelativeTime } from '@/lib/time'

function readingAge(capturedAt: string): string {
    const age = shortRelativeTime(capturedAt)
    return age === 'now' ? 'Updated just now' : `Updated ${age} ago`
}

// Where a subscription stands against its own plan: what the provider meters, not what Rerun bills.
export function PlanLimitsBlock({ connection }: { connection: Pick<BoxConnection, 'planLimits' | 'provider'> }) {
    const windows = livePlanWindows(connection)

    if (!connection.planLimits || windows.length === 0) {
        return (
            <DetailBlock title="Plan usage">
                <p className="text-[11px] text-muted-foreground">Usage shows up here after the next run on this plan.</p>
            </DetailBlock>
        )
    }

    return (
        <DetailBlock title="Plan usage" aside={<span className="text-[11px] text-muted-foreground">{readingAge(connection.planLimits.capturedAt)}</span>}>
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                {windows.map(window => {
                    const name = planWindowName(window, connection.provider)
                    const reset = planWindowReset(window)
                    return (
                        <div key={`${window.kind}:${window.label ?? ''}`} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-3 text-xs">
                                <span className="font-medium">{name}</span>
                                <span className="text-muted-foreground tabular-nums">
                                    {planWindowPercent(window)} used{reset ? `, ${reset}` : ''}
                                </span>
                            </div>
                            <PlanLimitMeter percent={window.usedPercent} label={`${name} limit used`} />
                        </div>
                    )
                })}
            </div>
        </DetailBlock>
    )
}
