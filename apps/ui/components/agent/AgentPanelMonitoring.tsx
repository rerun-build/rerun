'use client'

import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { readAgentMonitoringAction } from '@/app/api/_actions/agent.actions'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import type { StatsChartType, StatsDataset, StatsGroupBy, StatsMetric, StatsTimeRange, UsageTimeRange } from '@rerun/contracts'
import type { EngineStatsPoint, EngineUsageBucket } from '@/lib/engine/types'
import { StatsChart, TokenUsageChart, MonitorCard } from '@rerun/ui/monitoring'
import { ActivityIcon, AlertTriangleIcon, BarChart3Icon, CircleDollarSignIcon, CoinsIcon, CpuIcon, GaugeIcon, HashIcon, Maximize2Icon, TimerIcon, WrenchIcon } from '@/lib/icons'
import type { ComponentType, ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useCallback, useState } from 'react'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'

type StatSpec = {
    key: 'kpiRuns' | 'kpiCost' | 'kpiTokens' | 'kpiErrorRate' | 'runsOverTime' | 'costOverTime' | 'avgDuration' | 'runsByModel' | 'topTools' | 'toolErrors'
    icon: ComponentType<{ className?: string }>
    dataset: StatsDataset
    metric: StatsMetric
    groupBy: StatsGroupBy
    chartType: StatsChartType
}

const KPI_SPECS: StatSpec[] = [
    { key: 'kpiRuns', icon: HashIcon, dataset: 'runs', metric: 'count', groupBy: 'none', chartType: 'stat' },
    { key: 'kpiCost', icon: CircleDollarSignIcon, dataset: 'runs', metric: 'cost', groupBy: 'none', chartType: 'stat' },
    { key: 'kpiTokens', icon: CoinsIcon, dataset: 'runs', metric: 'totalTokens', groupBy: 'none', chartType: 'stat' },
    { key: 'kpiErrorRate', icon: GaugeIcon, dataset: 'runs', metric: 'errorRate', groupBy: 'none', chartType: 'stat' },
]

const CHART_SPECS: StatSpec[] = [
    { key: 'runsOverTime', icon: ActivityIcon, dataset: 'runs', metric: 'count', groupBy: 'status', chartType: 'bar' },
    { key: 'costOverTime', icon: CircleDollarSignIcon, dataset: 'runs', metric: 'cost', groupBy: 'none', chartType: 'area' },
    { key: 'avgDuration', icon: TimerIcon, dataset: 'runs', metric: 'avgDurationMs', groupBy: 'none', chartType: 'line' },
    { key: 'runsByModel', icon: CpuIcon, dataset: 'runs', metric: 'count', groupBy: 'model', chartType: 'donut' },
    { key: 'topTools', icon: WrenchIcon, dataset: 'toolCalls', metric: 'count', groupBy: 'toolName', chartType: 'bar' },
    { key: 'toolErrors', icon: AlertTriangleIcon, dataset: 'toolCalls', metric: 'errorCount', groupBy: 'toolName', chartType: 'bar' },
]

const ALL_SPECS = [...KPI_SPECS, ...CHART_SPECS]

const RANGES = ['24h', '7d', '30d', '90d'] as const satisfies readonly StatsTimeRange[]
const POLL_MS = 30000

type StatsData = Record<string, EngineStatsPoint[] | null>

export function AgentPanelMonitoring({ agentId }: { agentId: string }) {
    const t = useTranslations('agent.agentPanelMonitoring')
    const [range, setRange] = useState<StatsTimeRange>('7d')
    const [stats, setStats] = useState<StatsData>({})
    const [usage, setUsage] = useState<EngineUsageBucket[] | null>(null)
    const [loading, setLoading] = useState(true)
    const [expandedKey, setExpandedKey] = useState<string | null>(null)

    const load = useCallback(async () => {
        // The usage endpoint has no 90d bucket, so widen it to all-time for that range.
        const usageRange: UsageTimeRange = range === '90d' ? 'all' : range
        const { usage: usageResult, stats: statsResults } = await readAgentMonitoringAction(
            agentId,
            usageRange,
            ALL_SPECS.map(spec => ({ dataset: spec.dataset, metric: spec.metric, groupBy: spec.groupBy, range }))
        )
        const next: StatsData = {}
        ALL_SPECS.forEach((spec, i) => {
            next[spec.key] = statsResults[i] ?? []
        })
        setStats(next)
        setUsage(usageResult ?? [])
        setLoading(false)
    }, [agentId, range])

    useVisibleInterval(load, POLL_MS)

    const isEmpty = !loading && usage?.length === 0 && ALL_SPECS.every(spec => (stats[spec.key]?.length ?? 0) === 0)

    const chartPanels: { key: string; title: string; subtitle?: string; icon: ComponentType<{ className?: string }>; node: ReactNode }[] = [
        { key: 'tokenUsage', title: t('tokenUsage.title'), subtitle: t('tokenUsage.subtitle'), icon: CoinsIcon, node: <TokenUsageChart metric="tokens" breakdown="total" chartType="area" buckets={usage} /> },
        ...CHART_SPECS.map(spec => ({
            key: spec.key,
            title: t(`charts.${spec.key}`),
            icon: spec.icon,
            node: <StatsChart dataset={spec.dataset} metric={spec.metric} groupBy={spec.groupBy} chartType={spec.chartType} points={stats[spec.key] ?? null} />,
        })),
    ]
    const expanded = chartPanels.find(p => p.key === expandedKey) ?? null

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-end gap-1 border-b border-border px-3 py-2">
                {RANGES.map(r => (
                    <button
                        key={r}
                        onClick={() => setRange(r)}
                        title={t(`ranges.${r}.label`)}
                        className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${range === r ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}`}
                    >
                        {t(`ranges.${r}.short`)}
                    </button>
                ))}
            </div>

            {loading ? (
                <MonitoringSkeleton />
            ) : isEmpty ? (
                <EmptyState
                    className="h-full"
                    icon={BarChart3Icon}
                    title={t('empty.title')}
                    description={t('empty.description')}
                />
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    <div className="grid grid-cols-2 gap-3">
                        {KPI_SPECS.map(spec => (
                            <MonitorCard key={spec.key} className="h-32" title={t(`charts.${spec.key}`)} icon={spec.icon}>
                                <StatsChart dataset={spec.dataset} metric={spec.metric} groupBy={spec.groupBy} chartType={spec.chartType} points={stats[spec.key] ?? null} />
                            </MonitorCard>
                        ))}
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        {chartPanels.map(panel => (
                            <MonitorCard
                                key={panel.key}
                                className="h-56"
                                title={panel.title}
                                subtitle={panel.subtitle}
                                icon={panel.icon}
                                action={
                                    <button
                                        onClick={() => setExpandedKey(panel.key)}
                                        aria-label={t('expand', { title: panel.title })}
                                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                                    >
                                        <Maximize2Icon className="size-3.5" />
                                    </button>
                                }
                            >
                                {panel.node}
                            </MonitorCard>
                        ))}
                    </div>
                </div>
            )}

            <Dialog open={!!expanded} onOpenChange={open => !open && setExpandedKey(null)}>
                <DialogContent className="sm:max-w-3xl">
                    <DialogHeaderBar icon={ActivityIcon} title={expanded?.title} />
                    <div className="h-[60vh] w-full">{expanded?.node}</div>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function MonitoringSkeleton() {
    return (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-32" />
                ))}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-56" />
                ))}
            </div>
        </div>
    )
}
