'use client'

import { readFactorySnapshotAction } from '@/app/api/_actions/factory.actions'
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
import type { FactorySnapshot } from '@rerun/contracts'
import { formatDate, formatNumber } from '@rerun/i18n/format'
import { RunStatusBadge } from '@rerun/ui/monitoring'
import { CheckIcon, ChevronRightIcon, ScrollTextIcon, XIcon } from '@/lib/icons'
import { useLocale, useTranslations } from 'next-intl'
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'

function runTokens(run: EngineRun): number | undefined {
    return run.totalTokens ?? (((run.inputTokens ?? 0) + (run.outputTokens ?? 0)) || undefined)
}

function formatMs(ms: number | null): string {
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
const TABS: RunBucket[] = ['running', 'done', 'failed']
type SnapshotJobs = FactorySnapshot['jobs']

export function elapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000))
    if (total < 60) return `${total}s`
    const minutes = Math.floor(total / 60)
    if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function bucketOf(run: EngineRun): RunBucket {
    if (run.status === 'running') return 'running'
    if (run.status === 'error' || (run.status === 'cancelled' && run.error)) return 'failed'
    return 'done'
}

function matchesQuery(run: EngineRun, q: string): boolean {
    if (!q) return true
    const fields = [run.jobRef, run.branch, run.triggerSlug, run.triggerSource, run.model, run.error, run.id, ...(run.goal?.lastLineForms.map(f => f.prefix) ?? [])]
    return fields.some(f => f && f.toLowerCase().includes(q))
}

function rowTitle(run: EngineRun, jobs: SnapshotJobs, fmt: { row: (stage: string, n: number, title: string) => string; goal: (prefix: string) => string }, locale: string): string {
    if (run.jobRef) {
        const m = /#(\d+)$/.exec(run.jobRef)
        const job = m ? jobs.find(j => j.issue === Number(m[1])) : undefined
        if (!job) return run.jobRef
        const stage = job.runs?.find(r => r.runId === run.id)?.stage ?? 'run'
        return fmt.row(stage, job.issue, job.title)
    }
    const prefix = run.goal?.lastLineForms[0]?.prefix
    if (prefix) return fmt.goal(prefix)
    const trigger = run.triggerSlug ?? run.triggerSource
    if (trigger) return trigger
    return run.startedAt ? formatDate(run.startedAt, locale) : run.id
}

type RunDetail = { steps: EngineRunStep[]; tools: EngineToolCall[] }

export function AgentPanelLogs({ agentId }: { agentId: string }) {
    const t = useTranslations('agent.agentPanelLogs')
    const [runs, setRuns] = useState<EngineRun[]>([])
    const [loading, setLoading] = useState(true)
    const [details, setDetails] = useState<Record<string, RunDetail>>({})
    const loadingDetails = useRef(new Set<string>())
    const [tab, setTab] = useState<RunBucket>('running')
    const [query, setQuery] = useState('')
    const [jobs, setJobs] = useState<SnapshotJobs>([])
    const [liveTools, setLiveTools] = useState<Record<string, string | undefined>>({})
    const [now, setNow] = useState(() => Date.now())
    const locale = useLocale()

    useEffect(() => {
        let alive = true
        readFactorySnapshotAction()
            .then(r => alive && setJobs(r?.snapshot.jobs ?? []))
            .catch(() => undefined)
        return () => {
            alive = false
        }
    }, [])

    const load = useCallback(async () => {
        const next = await listRunsAction(agentId, 100)
        setRuns(next)
        setLoading(false)
        const live = next.filter(r => bucketOf(r) === 'running')
        const picked = await Promise.all(live.map(async r => [r.id, (await getRunToolsAction(agentId, r.id).catch(() => [] as EngineToolCall[])).at(-1)?.toolName] as const))
        setLiveTools(Object.fromEntries(picked))
    }, [agentId])

    useEffect(() => {
        setLoading(true)
    }, [load])

    const running = runs.filter(r => bucketOf(r) === 'running').length
    useVisibleInterval(load, running > 0 ? 5000 : 30000)

    useEffect(() => {
        if (running === 0) return
        setNow(Date.now())
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
    }, [running > 0])

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
    const shown = runs.filter(r => bucketOf(r) === tab && matchesQuery(r, q))
    const fmt = {
        row: (stage: string, n: number, title: string) => t('rowTitle', { stage: t('stage', { stage }), n, title }),
        goal: (prefix: string) => t('goalRow', { prefix }),
    }
    const failedAlert = counts.failed > 0

    return (
        <div className="flex h-full flex-col">
            <PanelScroller>
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <div role="tablist" className="flex items-center gap-1.5">
                        {TABS.map(b => (
                            <button
                                key={b}
                                type="button"
                                role="tab"
                                aria-selected={tab === b}
                                {...(b === 'failed' && failedAlert ? { 'data-alert': true } : {})}
                                onClick={() => setTab(b)}
                                className={cn(
                                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                                    tab === b ? 'border-primary/50 bg-primary/10' : 'border-border hover:bg-accent/30',
                                    b === 'failed' && failedAlert ? 'text-destructive' : tab === b ? 'text-foreground' : 'text-muted-foreground'
                                )}
                            >
                                {t(`filters.${b}`)} {counts[b]}
                            </button>
                        ))}
                    </div>
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
                    q ? (
                        <EmptyState icon={ScrollTextIcon} title={t('noMatch', { query: query.trim() })} />
                    ) : tab === 'running' ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                            {t.rich('nothingRunning', {
                                done: c => (
                                    <button type="button" className="underline underline-offset-2" onClick={() => setTab('done')}>
                                        {c}
                                    </button>
                                ),
                                failed: c => (
                                    <button type="button" className="underline underline-offset-2" onClick={() => setTab('failed')}>
                                        {c}
                                    </button>
                                ),
                            })}
                        </p>
                    ) : (
                        <EmptyState icon={ScrollTextIcon} title={t('empty.title')} />
                    )
                ) : (
                    <PanelList>
                        {shown.map(run => (
                            <RunRow key={run.id} run={run} title={rowTitle(run, jobs, fmt, locale)} now={now} liveTool={liveTools[run.id]} detail={details[run.id]} onOpen={() => loadDetail(run.id)} />
                        ))}
                    </PanelList>
                )}
            </PanelScroller>
        </div>
    )
}

function RunRow({ run, title, now, liveTool, detail, onOpen }: { run: EngineRun; title: string; now: number; liveTool?: string; detail?: RunDetail; onOpen: () => void }) {
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
                    <span className="flex-1 truncate text-sm">{title}</span>
                    <RunStatusBadge status={run.status} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pl-6 text-[10px] text-muted-foreground">
                    {typeof run.stepCount === 'number' && (
                        <span>{t('stepCount', { count: run.stepCount })}</span>
                    )}
                    {run.status === 'running' && run.startedAt && (
                        <>
                            <span>·</span>
                            <span>{elapsed(now - Date.parse(run.startedAt))}</span>
                        </>
                    )}
                    {run.status === 'running' && liveTool && (
                        <>
                            <span>·</span>
                            <span>{t('currentStep', { tool: liveTool })}</span>
                        </>
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
                        <p className="py-2 text-xs text-muted-foreground">{run.status !== 'running' && run.stepCount > 0 ? t('stepsLost', { count: run.stepCount }) : t('noSteps')}</p>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {detail.steps.map(step => (
                                <StepRow key={step.id} step={step} tools={detail.tools.filter(tool => tool.stepNumber === step.stepNumber)} />
                            ))}
                            {detail.tools.filter(tool => !detail.steps.some(step => step.stepNumber === tool.stepNumber)).map(tool => (
                                <ToolRow key={tool.id} tool={tool} />
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
                {step.durationMs != null && <span className="text-muted-foreground">{formatMs(step.durationMs)}</span>}
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
                {isError ? <XIcon className="size-3 shrink-0 text-destructive" /> : tool.resultJson !== null && <CheckIcon className="size-3 shrink-0 text-emerald-500" />}
                <span className="flex-1" />
                {tool.durationMs != null && <span className="shrink-0 text-muted-foreground">{formatMs(tool.durationMs)}</span>}
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
