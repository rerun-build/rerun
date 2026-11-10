'use client'

import { adoptEngineSessionAction } from '@/app/api/_actions/session.actions'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PanelList, PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { SkeletonPanelRows } from '@/components/ui/skeleton'
import type { EngineRun } from '@/lib/engine/types'
import { ArrowLeftIcon, Loader2Icon } from '@/lib/icons'
import { formatDate, formatNumber } from '@rerun/i18n/format'
import { RunStatusBadge } from '@rerun/ui/monitoring'
import { useLocale, useTranslations } from 'next-intl'
import { type ComponentType, useCallback, useState } from 'react'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'

// The Supabase mirror row is normally created by the engine's session webhook; adopting is
// idempotent, and the single retry absorbs the insert race right after a run fires.
export async function adoptRunSession(agentId: string, engineSessionId: string, title: string): Promise<string> {
    return adoptEngineSessionAction(agentId, engineSessionId, title).catch(() => adoptEngineSessionAction(agentId, engineSessionId, title))
}

type RunHistoryTranslator = ReturnType<typeof useTranslations<'agent.agentRunHistory'>>

function usageTokens(usageJson: string | null | undefined): number | undefined {
    if (!usageJson) return undefined
    try {
        const u = JSON.parse(usageJson) as { totalTokens?: number; inputTokens?: number; outputTokens?: number }
        return u.totalTokens ?? ((u.inputTokens ?? 0) + (u.outputTokens ?? 0) || undefined)
    } catch {
        return undefined
    }
}

function runMeta(run: { stepCount?: number | null; usageJson?: string | null }, locale: string, t: RunHistoryTranslator): string {
    const tokens = usageTokens(run.usageJson)
    const usage = tokens ? t('tokens', { total: formatNumber(tokens, locale) }) : ''
    const steps = typeof run.stepCount === 'number' ? t('stepCount', { count: run.stepCount }) : ''
    return [steps, usage].filter(Boolean).join(' · ')
}

type RunHistoryListProps = {
    title: string
    loadRuns: () => Promise<EngineRun[]>
    emptyIcon: ComponentType<{ className?: string }>
    emptyLabel: string
    onBack: () => void
    onSelectRun: (run: EngineRun) => Promise<void>
}

export function RunHistoryList({ title, loadRuns, emptyIcon: EmptyIcon, emptyLabel, onBack, onSelectRun }: RunHistoryListProps) {
    const t = useTranslations('agent.agentRunHistory')
    const locale = useLocale()
    const [runs, setRuns] = useState<EngineRun[]>([])
    const [loading, setLoading] = useState(true)
    const [openingRunId, setOpeningRunId] = useState<string | null>(null)

    const load = useCallback(async () => {
        setRuns(await loadRuns())
        setLoading(false)
    }, [loadRuns])

    useVisibleInterval(load, 30000)

    const handleSelect = useCallback(async (run: EngineRun) => {
        setOpeningRunId(run.id)
        try {
            await onSelectRun(run)
        } finally {
            setOpeningRunId(null)
        }
    }, [onSelectRun])

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <Button size="icon-sm" variant="ghost" onClick={onBack}>
                    <ArrowLeftIcon className="size-4" />
                </Button>
                <span className="text-sm font-medium truncate">{title}</span>
            </div>

            {loading ? (
                <SkeletonPanelRows rows={5} badge />
            ) : runs.length === 0 ? (
                <EmptyState className="h-full" icon={EmptyIcon} title={emptyLabel} />
            ) : (
                <PanelScroller>
                    <PanelList>
                        {runs.map(r => (
                            <PanelRow
                                key={r.id}
                                disabled={openingRunId !== null}
                                onClick={() => handleSelect(r)}
                                title={r.startedAt ? formatDate(r.startedAt, locale) : r.id}
                                description={runMeta(r, locale, t)}
                                meta={openingRunId === r.id ? <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" /> : <RunStatusBadge status={r.status} />}
                            />
                        ))}
                    </PanelList>
                </PanelScroller>
            )}
        </div>
    )
}
