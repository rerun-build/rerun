'use client'

import { DetailBlock } from '@/components/connections/DetailBlock'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { opencodeModelRows, pricePerMillion, type OpencodeModelRow } from '@/lib/engine/ai-sources'
import type { BoxConnection } from '@/lib/engine/types'
import { SearchIcon, StarIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { OpencodePlan } from '@rerun/contracts'
import { Badge } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

const SECTIONS = [
    { plan: 'go', title: 'goTitle', hint: 'goHint' },
    { plan: 'console', title: 'consoleTitle', hint: 'consoleHint' },
] as const satisfies readonly { plan: OpencodePlan; title: string; hint: string }[]

function matches(row: OpencodeModelRow, query: string): boolean {
    if (!query) return true
    const needle = query.toLowerCase()
    return row.label.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle)
}

function ModelRow({ row, isDefault, lockReason, onToggle }: { row: OpencodeModelRow; isDefault: boolean; lockReason?: string; onToggle: (on: boolean) => void }) {
    const t = useTranslations('connections')
    const locale = useLocale()
    const toggle = <Switch checked={row.enabled} disabled={!!lockReason} onCheckedChange={onToggle} aria-label={row.enabled ? t('models.turnOff', { model: row.label }) : t('models.turnOn', { model: row.label })} />
    return (
        <li className={cn('flex min-h-11 items-center gap-3 px-3 py-2', !row.enabled && 'text-muted-foreground')}>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className={cn('truncate text-xs font-medium', row.enabled && 'text-foreground')}>{row.label}</span>
                    {isDefault && <StarIcon aria-label={t('models.defaultModel')} className="size-3 shrink-0 text-yellow-400 [&_polygon]:fill-current" />}
                    <Badge size="xs" tone={row.plan === 'go' ? 'green' : 'cyan'} className="shrink-0">
                        {row.plan === 'go' ? t('opencode.included') : t('opencode.credits')}
                    </Badge>
                    {row.isNew && (
                        <Badge size="xs" tone="brand" className="shrink-0">
                            {t('opencode.new')}
                        </Badge>
                    )}
                    {row.info && !row.info.images && (
                        <Badge size="xs" tone="neutral" className="shrink-0">
                            {t('opencode.noVision')}
                        </Badge>
                    )}
                </div>
                {(row.unavailable || (row.plan === 'console' && row.info)) && <span className="truncate text-[11px] text-muted-foreground">{row.unavailable ?? pricePerMillion(row.info!.price, t, locale)}</span>}
            </div>
            {lockReason ? <TooltipLabeled label={lockReason}>{toggle}</TooltipLabeled> : toggle}
        </li>
    )
}

type OpencodeModelsProps = {
    connection: BoxConnection
    // The workspace default when it sits on this connection, which can never be turned off.
    defaultModel: string | null
    onModelsChange: (models: string[]) => void
}

// OpenCode lists dozens of models over two catalogs, too many for the drag-and-drop zones: one
// switch per model, the Go ones first, a search across both.
export function OpencodeModels({ connection, defaultModel, onModelsChange }: OpencodeModelsProps) {
    const t = useTranslations('connections')
    const [query, setQuery] = useState('')
    const rows = useMemo(() => opencodeModelRows(connection, t), [connection, t])
    const enabledCount = rows.filter(row => row.enabled).length
    const trimmed = query.trim()

    const lockReason = (row: OpencodeModelRow): string | undefined => {
        if (row.id === defaultModel) return t('models.lockDefault')
        if (row.enabled && enabledCount === 1) return t('models.lockLast')
        return undefined
    }

    const toggle = (row: OpencodeModelRow, on: boolean) => {
        if (on === row.enabled) return
        onModelsChange(on ? [...connection.models, row.id] : connection.models.filter(id => id !== row.id))
    }

    return (
        <div className="space-y-4">
            <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label={t('opencode.search')} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('opencode.search')} className="h-8 pl-8 text-xs" />
            </div>
            {SECTIONS.map(section => {
                const inPlan = rows.filter(row => row.plan === section.plan)
                const shown = inPlan.filter(row => matches(row, trimmed))
                if (trimmed && shown.length === 0) return null
                return (
                    <DetailBlock
                        key={section.plan}
                        title={t(`opencode.${section.title}`)}
                        aside={
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                                {t('opencode.count', { on: inPlan.filter(row => row.enabled).length, total: inPlan.length })}
                            </span>
                        }
                    >
                        <p className="text-[11px] text-muted-foreground">{t(`opencode.${section.hint}`)}</p>
                        {shown.length === 0 ? (
                            <p className="rounded-md border border-dashed px-3 py-2.5 text-[11px] text-muted-foreground">{t('opencode.emptySection')}</p>
                        ) : (
                            <ul className="divide-y rounded-md border bg-muted/20">
                                {shown.map(row => (
                                    <ModelRow key={row.id} row={row} isDefault={row.id === defaultModel} lockReason={lockReason(row)} onToggle={on => toggle(row, on)} />
                                ))}
                            </ul>
                        )}
                    </DetailBlock>
                )
            })}
            {trimmed && rows.every(row => !matches(row, trimmed)) && <p className="text-[11px] text-muted-foreground">{t('opencode.noMatch', { query: trimmed })}</p>}
        </div>
    )
}
