'use client'

import type { AgentShareInclude, ShareBucket } from '@rerun/contracts'
import { Field } from '@/components/ui/field'
import { PANEL_CARD } from '@/components/ui/panel-row'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes } from '@/lib/files/format'
import { cn } from '@/lib/utils'
import type { AgentSharePlan } from '@/lib/agents/share-create'
import { useLocale, useTranslations } from 'next-intl'

function bucketValues(bucket: ShareBucket, locale: string) {
    return { count: bucket.count, size: formatBytes(bucket.bytes, locale) }
}

const CONTAINER = cn(PANEL_CARD, 'divide-y divide-border')
const ROW = 'p-3'

export function ShareAgentOptions({ plan, include, onChange, disabled }: { plan: AgentSharePlan; include: AgentShareInclude; onChange: (next: Partial<AgentShareInclude>) => void; disabled: boolean }) {
    const locale = useLocale()
    const t = useTranslations('agent.shareAgentOptions')
    const { memories, database, files } = plan.contents
    const rows = [
        {
            key: 'memories' as const,
            label: t('memories'),
            helper: memories.count === 0 ? t('memoriesEmpty') : t('memoriesCount', bucketValues(memories, locale)),
            value: include.memories,
        },
        {
            key: 'database' as const,
            label: t('database'),
            helper: database.count === 0 ? t('databaseEmpty') : t('databaseSize', { size: formatBytes(database.bytes, locale) }),
            value: include.database,
        },
        {
            key: 'files' as const,
            label: t('files'),
            helper: files.count === 0 ? t('filesEmpty') : t('filesCount', bucketValues(files, locale)),
            value: include.files,
        },
    ]

    return (
        <div className={CONTAINER}>
            {rows.map(row => (
                <Field key={row.key} orientation="row" label={row.label} helperText={row.helper} className={ROW}>
                    <Switch checked={row.value} disabled={disabled} onCheckedChange={checked => onChange({ [row.key]: checked })} aria-label={row.label} />
                </Field>
            ))}
        </div>
    )
}

export function ShareAgentOptionsSkeleton() {
    return (
        <div className={CONTAINER}>
            {['memories', 'database', 'files'].map(key => (
                <div key={key} className={cn(ROW, 'flex items-center justify-between gap-4')}>
                    <div className="flex flex-col gap-1.5">
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="h-3 w-40" />
                    </div>
                    <Skeleton className="h-5 w-9 rounded-full" />
                </div>
            ))}
        </div>
    )
}
