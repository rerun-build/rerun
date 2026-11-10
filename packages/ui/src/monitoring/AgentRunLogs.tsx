'use client'

import type { Run } from '@rerun/contracts'
import { formatDate, formatNumber } from '@rerun/i18n/format'
import type { LucideIcon } from '../icons'
import { AlertCircleIcon, BanIcon, CheckIcon, ChevronRightIcon, LoaderIcon, ScrollTextIcon } from '../icons'
import { Icon } from '../primitives/icon'
import { Badge, type BadgeTone } from '../primitives/badge'
import { useKitTranslations, useUiLocale } from '../locale'
import type { KitTranslator } from '../kit-translator'

export const RUN_STATUS_META: Record<Run['status'], { icon: LucideIcon; color: string; tint: string; tone: BadgeTone }> = {
    running: { icon: LoaderIcon, color: 'text-amber-400', tint: 'border-amber-400/20 bg-amber-400/10 text-amber-400', tone: 'orange' },
    done: { icon: CheckIcon, color: 'text-emerald-400', tint: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400', tone: 'green' },
    error: { icon: AlertCircleIcon, color: 'text-red-400', tint: 'border-red-400/20 bg-red-400/10 text-red-400', tone: 'red' },
    cancelled: { icon: BanIcon, color: 'text-muted-foreground', tint: 'border-muted-foreground/20 bg-muted-foreground/10 text-muted-foreground', tone: 'neutral' },
}

function runStatusLabel(status: Run['status'], t: KitTranslator): string {
    return t(`monitoring.runStatus.${status in RUN_STATUS_META ? status : 'done'}`)
}

export function RunStatusBadge({ status }: { status: Run['status'] }) {
    const t = useKitTranslations()
    const meta = RUN_STATUS_META[status] ?? RUN_STATUS_META.done
    return (
        <Badge tone={meta.tone} size="xs" className="font-medium uppercase tracking-wide">
            {runStatusLabel(status, t)}
        </Badge>
    )
}

function formatUsage(run: Run, locale: string, t: KitTranslator): string {
    const total = run.totalTokens ?? (((run.inputTokens ?? 0) + (run.outputTokens ?? 0)) || undefined)
    return total ? t('monitoring.runs.tokens', { tokens: formatNumber(total, locale) }) : ''
}

function SkeletonRows({ rows }: { rows: number }) {
    return (
        <div className="flex flex-col gap-2">
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="h-8 animate-pulse rounded-md bg-accent/40" />
            ))}
        </div>
    )
}

export type AgentRunLogsProps = {
    runs: Run[]
    loading?: boolean
    onOpenRun: (runId: string) => void
}

export function AgentRunLogs({ runs, loading, onOpenRun }: AgentRunLogsProps) {
    const t = useKitTranslations()
    if (loading) {
        return (
            <div className="p-3">
                <SkeletonRows rows={6} />
            </div>
        )
    }

    if (runs.length === 0) {
        return (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
                <Icon size="lg" icon={ScrollTextIcon} className="text-muted-foreground" />
                <div className="flex flex-col gap-0.5">
                    <p className="text-[13px] font-medium text-foreground">{t('monitoring.runs.emptyTitle')}</p>
                    <p className="text-[11px] text-muted-foreground">{t('monitoring.runs.emptyDescription')}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-0.5">
                {runs.map(run => (
                    <RunRow key={run.id} run={run} onOpen={() => onOpenRun(run.id)} />
                ))}
            </div>
        </div>
    )
}

function RunRow({ run, onOpen }: { run: Run; onOpen: () => void }) {
    const locale = useUiLocale()
    const t = useKitTranslations()
    const meta = RUN_STATUS_META[run.status] ?? RUN_STATUS_META.done
    const usage = formatUsage(run, locale, t)
    const trigger = run.triggerSlug ?? run.triggerSource
    return (
        <button
            type="button"
            onClick={onOpen}
            className="group/row flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent"
        >
            <Icon size="sm" icon={meta.icon} className={meta.tint} />
            <div className="flex min-w-0 flex-1 flex-col">
                {/* The visitor's own clock, which the server rendering this row cannot know. */}
                <span suppressHydrationWarning className="truncate text-[13px] font-medium text-foreground">
                    {run.startedAt ? formatDate(run.startedAt, locale) : run.id}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className={meta.color}>{runStatusLabel(run.status, t)}</span>
                    {typeof run.stepCount === 'number' && (
                        <>
                            <span className="text-muted-foreground/50">·</span>
                            <span className="shrink-0">{t('monitoring.runs.steps', { count: run.stepCount })}</span>
                        </>
                    )}
                    {usage && (
                        <>
                            <span className="text-muted-foreground/50">·</span>
                            <span className="shrink-0">{usage}</span>
                        </>
                    )}
                    {run.model && (
                        <>
                            <span className="text-muted-foreground/50">·</span>
                            <span className="truncate font-mono">{run.model}</span>
                        </>
                    )}
                    {trigger && (
                        <>
                            <span className="text-muted-foreground/50">·</span>
                            <span className="truncate">{trigger}</span>
                        </>
                    )}
                </span>
            </div>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover/row:opacity-100" />
        </button>
    )
}
