'use client'

import { getRunStepsAction, getRunToolsAction, listRunsAction } from '@/app/api/_actions/agent.actions'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { EmptyState } from '@/components/ui/empty-state'
import { PanelList, PanelScroller } from '@/components/ui/panel-list'
import { PANEL_CARD, PANEL_CARD_INTERACTIVE } from '@/components/ui/panel-row'
import { SkeletonPanelRows, SkeletonRows } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { modelLogLabel } from '@/lib/engine/models'
import type { EngineRun, EngineRunStep, EngineToolCall } from '@/lib/engine/types'
import { toolIconOf } from '@/lib/tool-meta'
import { formatDate, formatNumber } from '@rerun/i18n/format'
import { RunStatusBadge } from '@rerun/ui/monitoring'
import { CheckIcon, ChevronRightIcon, ScrollTextIcon, XIcon } from '@/lib/icons'
import { useLocale, useTranslations } from 'next-intl'
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'

function runTokens(run: EngineRun): number | undefined {
    return run.totalTokens ?? (((run.inputTokens ?? 0) + (run.outputTokens ?? 0)) || undefined)
}

function formatDuration(ms: number | null): string {
    if (ms == null) return ''
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function prettyJson(raw: string | null): string | null {
    if (!raw) return null
    try {
        return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
        return raw
    }
}

export type RunBucket = 'running' | 'failed' | 'done'
const BUCKETS: RunBucket[] = ['running', 'failed', 'done']
type BucketFlags = Record<RunBucket, boolean>
const FILTER_KEY = 'rerun.agentLogs.filter'
const DEFAULT_FLAGS: BucketFlags = { running: true, failed: true, done: false }

export function bucketOf(run: EngineRun): RunBucket {
    if (run.status === 'running') return 'running'
    if (run.status === 'error' || (run.status === 'cancelled' && run.error)) return 'failed'
    return 'done'
}

function readFlags(): BucketFlags {
    try {
        if (typeof localStorage === 'undefined') return DEFAULT_FLAGS
        const raw = localStorage.getItem(FILTER_KEY)
        if (!raw) return DEFAULT_FLAGS
        const v = JSON.parse(raw) as Partial<Record<RunBucket, unknown>>
        return {
            running: typeof v.running === 'boolean' ? v.running : DEFAULT_FLAGS.running,
            failed: typeof v.failed === 'boolean' ? v.failed : DEFAULT_FLAGS.failed,
            done: typeof v.done === 'boolean' ? v.done : DEFAULT_FLAGS.done,
        }
    } catch {
        return DEFAULT_FLAGS
    }
}

function matchesQuery(run: EngineRun, q: string): boolean {
    if (!q) return true
    const fields = [run.jobRef, run.branch, run.triggerSlug, run.triggerSource, run.model, run.error, run.id, ...(run.goal?.lastLineForms.map(f => f.prefix) ?? [])]
    return fields.some(f => f && f.toLowerCase().includes(q))
}

type RunDetail = { steps: EngineRunStep[]; tools: EngineToolCall[] }

export function AgentPanelLogs({ agentId }: { agentId: string }) {
    const t = useTranslations('agent.agentPanelLogs')
    const [runs, setRuns] = useState<EngineRun[]>([])
    const [loading, setLoading] = useState(true)
    const [details, setDetails] = useState<Record<string, RunDetail>>({})
    const loadingDetails = useRef(new Set<string>())
    const [flags, setFlags] = useState<BucketFlags>(readFlags)
    const [query, setQuery] = useState('')
    const locale = useLocale()

    const toggle = (b: RunBucket) => {
        const next = { ...flags, [b]: !flags[b] }
        setFlags(next)
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(FILTER_KEY, JSON.stringify(next))
        } catch {
            // blocked storage: the choice just is not kept
        }
    }

    const load = useCallback(async () => {
        const next = await listRunsAction(agentId, 100)
        setRuns(next)
        setLoading(false)
    }, [agentId])

    useEffect(() => {
        setLoading(true)
    }, [load])

    useVisibleInterval(load, 30000)

    const loadDetail = useCallback(
        async (runId: string) => {
            if (details[runId] || loadingDetails.current.has(runId)) return
            loadingDetails.current.add(runId)
            const [steps, tools] = await Promise.all([getRunStepsAction(agentId, runId), getRunToolsAction(agentId, runId)])
            setDetails(prev => ({ ...prev, [runId]: { steps, tools } }))
            loadingDetails.current.delete(runId)
        },
        [agentId, details]
    )

    if (loading) {
        return <SkeletonPanelRows rows={6} badge />
    }

    if (runs.length === 0) {
        return (
            <EmptyState
                className="h-full"
                icon={ScrollTextIcon}
                title={t('empty.title')}
                description={t('empty.description')}
            />
        )
    }

    const counts: Record<RunBucket, number> = { running: 0, failed: 0, done: 0 }
    for (const r of runs) counts[bucketOf(r)]++
    const q = query.trim().toLowerCase()
    const shown = runs.filter(r => flags[bucketOf(r)] && matchesQuery(r, q))
    const hiddenParts = BUCKETS.filter(b => !flags[b] && counts[b] > 0).map(b => {
        const count = counts[b]
        return b === 'running' ? t('hiddenRunning', { count }) : b === 'failed' ? t('hiddenFailed', { count }) : t('hiddenDone', { count })
    })
    const hiddenText = t('hidden', { parts: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(hiddenParts) })

    return (
        <div className="flex h-full flex-col">
            <PanelScroller>
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {BUCKETS.map(b => (
                        <button
                            key={b}
                            type="button"
                            data-chip
                            aria-pressed={flags[b]}
                            onClick={() => toggle(b)}
                            className={cn('rounded-full border px-2.5 py-0.5 text-xs transition-colors', flags[b] ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent/30')}
                        >
                            {t(`filters.${b}`)} {counts[b]}
                        </button>
                    ))}
                    <input
                        type="search"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        aria-label={t('search')}
                        placeholder={t('search')}
                        className="min-w-32 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
                    />
                </div>
                {shown.length === 0 ? (
                    <EmptyState icon={ScrollTextIcon} title={q ? t('noMatch', { query: query.trim() }) : hiddenText} />
                ) : (
                    <PanelList>
                        {shown.map(run => (
                            <RunRow key={run.id} run={run} detail={details[run.id]} onOpen={() => loadDetail(run.id)} />
                        ))}
                    </PanelList>
                )}
            </PanelScroller>
        </div>
    )
}

function RunRow({ run, detail, onOpen }: { run: EngineRun; detail?: RunDetail; onOpen: () => void }) {
    const t = useTranslations('agent.agentPanelLogs')
    const locale = useLocale()
    const tokens = runTokens(run)
    const usage = tokens ? t('tokens', { total: formatNumber(tokens, locale) }) : ''
    const trigger = run.triggerSlug ?? run.triggerSource
    return (
        <Collapsible data-run onOpenChange={open => open && onOpen()} className={cn(PANEL_CARD, 'overflow-hidden')}>
            <CollapsibleTrigger className={cn('group flex w-full flex-col gap-0.5 p-3 text-left', PANEL_CARD_INTERACTIVE)}>
                <div className="flex items-center gap-2">
                    <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                    <span className="flex-1 truncate text-sm">{run.startedAt ? formatDate(run.startedAt, locale) : run.id}</span>
                    <RunStatusBadge status={run.status} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pl-6 text-[10px] text-muted-foreground">
                    {typeof run.stepCount === 'number' && (
                        <span>{t('stepCount', { count: run.stepCount })}</span>
                    )}
                    {usage && (
                        <>
                            <span>·</span>
                            <span>{usage}</span>
                        </>
                    )}
                    {run.model && (
                        <>
                            <span>·</span>
                            <span className="font-mono">{modelLogLabel(run.model)}</span>
                        </>
                    )}
                    {trigger && (
                        <>
                            <span>·</span>
                            <span>{trigger}</span>
                        </>
                    )}
                </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="px-3 pb-3 pl-9">
                    {run.error && <div className="mb-2 whitespace-pre-wrap break-all rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{run.error}</div>}
                    {!detail ? (
                        <div className="py-2">
                            <SkeletonRows rows={3} />
                        </div>
                    ) : detail.steps.length === 0 && detail.tools.length === 0 ? (
                        <p className="py-2 text-xs text-muted-foreground">{t('noSteps')}</p>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {detail.steps.map(step => (
                                <StepRow key={step.id} step={step} tools={detail.tools.filter(tool => tool.stepNumber === step.stepNumber)} />
                            ))}
                        </div>
                    )}
                </div>
            </CollapsibleContent>
        </Collapsible>
    )
}

function StepRow({ step, tools }: { step: EngineRunStep; tools: EngineToolCall[] }) {
    const t = useTranslations('agent.agentPanelLogs')
    const locale = useLocale()
    return (
        <div className="divide-y divide-border/40">
            <div className="flex items-center gap-2 py-1.5 text-xs">
                <span className="font-medium">{t('step', { number: step.stepNumber })}</span>
                {step.finishReason && <span className="text-muted-foreground">{step.finishReason}</span>}
                <span className="flex-1" />
                {step.totalTokens != null && <span className="text-muted-foreground">{t('tokensShort', { total: formatNumber(step.totalTokens, locale) })}</span>}
                {step.durationMs != null && <span className="text-muted-foreground">{formatDuration(step.durationMs)}</span>}
            </div>
            {tools.length > 0 && (
                <div className="flex flex-col">
                    {tools.map(tool => (
                        <ToolRow key={tool.id} tool={tool} />
                    ))}
                </div>
            )}
        </div>
    )
}

function ToolRow({ tool }: { tool: EngineToolCall }) {
    const t = useTranslations('agent.agentPanelLogs')
    const input = prettyJson(tool.inputJson)
    const output = prettyJson(tool.resultJson)
    const isError = tool.isError !== 0
    return (
        <Collapsible className="border-t border-border/40 first:border-t-0">
            <CollapsibleTrigger className="group flex w-full items-center gap-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/30">
                <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                {createElement(toolIconOf(tool.toolName), { className: 'size-3.5 shrink-0 text-muted-foreground' })}
                <span className="truncate font-mono">{tool.toolName}</span>
                {isError ? <XIcon className="size-3 shrink-0 text-destructive" /> : <CheckIcon className="size-3 shrink-0 text-emerald-500" />}
                <span className="flex-1" />
                {tool.durationMs != null && <span className="shrink-0 text-muted-foreground">{formatDuration(tool.durationMs)}</span>}
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="flex flex-col gap-2 pb-2 pl-5">
                    {input && <JsonBlock label={t('input')} json={input} />}
                    {output && <JsonBlock label={t('output')} json={output} error={isError} />}
                </div>
            </CollapsibleContent>
        </Collapsible>
    )
}

function JsonBlock({ label, json, error }: { label: string; json: string; error?: boolean }) {
    return (
        <div>
            <span className="text-[10px] font-medium uppercase text-muted-foreground">{label}</span>
            <pre className={`mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-background px-2 py-1.5 font-mono text-[11px] ${error ? 'text-destructive' : 'text-foreground'}`}>{json}</pre>
        </div>
    )
}
