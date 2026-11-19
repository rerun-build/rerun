'use client'

import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { FactoryJob } from '@moldwright/contracts'
import { JOB_STATE_VIEW, groupOf } from './factory-state'
import { formatInState } from './FactoryTasks'

const HINT = 'Pick a task in the list or on the floor'
const NO_HISTORY = 'No earlier history from the delegator yet'
const NO_RUNS = 'No runs recorded yet'
const NA = 'n/a'

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour12: false })
const num = (n: number | null) => (n === null ? NA : String(n))

function StateIcon({ state }: { state: FactoryJob['state'] }) {
    const v = JOB_STATE_VIEW[state]
    const Icon = v.icon
    return <Icon className="size-4 shrink-0" style={{ color: v.color }} aria-hidden />
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{children}</dd>
        </div>
    )
}

export function FactoryInspector({ job, jobs, repo, names, onSelect, onOpenCoworker }: {
    job: FactoryJob | null
    jobs: FactoryJob[]
    repo: string
    names: Record<string, string>
    onSelect: (issue: number) => void
    onOpenCoworker: (coworkerId: string) => void
}) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
    }, [])

    if (job === null) return <div className="p-4 text-sm text-muted-foreground">{HINT}</div>

    const base = `https://github.com/${repo}`
    const history = job.history
        ? [...job.history].reverse()
        : [{ state: job.state, at: job.enteredAt, reason: job.reason, runId: null }]
    const runs = job.runs ? [...job.runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)) : null
    const linkCls = 'shrink-0 text-muted-foreground hover:text-foreground'

    return (
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
            <header className="flex items-center gap-2">
                <StateIcon state={job.state} />
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">#{job.issue}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{job.title}</span>
                <a href={`${base}/issues/${job.issue}`} target="_blank" rel="noreferrer" aria-label="Issue" className={linkCls}><ExternalLink className="size-3.5" /></a>
                {job.pr !== null && (
                    <>
                        <a href={`${base}/pull/${job.pr}`} target="_blank" rel="noreferrer" aria-label={`PR ${job.pr}`} className={linkCls}><ExternalLink className="size-3.5" /></a>
                        <a href={`${base}/pull/${job.pr}/files`} target="_blank" rel="noreferrer" aria-label="PR files" className={linkCls}><ExternalLink className="size-3.5" /></a>
                    </>
                )}
            </header>

            <dl className="flex flex-col gap-1">
                <Fact label="Coworker">{job.coworker === null ? NA : job.copy === null ? job.coworker : `${job.coworker} · ${job.copy}`}</Fact>
                <Fact label="Round">{num(job.round)}</Fact>
                <Fact label="Steps">{num(job.steps)}</Fact>
                <Fact label="Tokens in">{num(job.tokensIn)}</Fact>
                <Fact label="Tokens out">{num(job.tokensOut)}</Fact>
                <Fact label="In state">{formatInState(now - Date.parse(job.enteredAt))}</Fact>
                {job.parent !== null && <Fact label="Feature">#{job.parent}</Fact>}
            </dl>

            {job.dependsOn.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">Depends on</span>
                    {job.dependsOn.map((n) => (
                        <button key={n} type="button" onClick={() => onSelect(n)} title={jobs.find((j) => j.issue === n)?.title}
                            className="rounded-full bg-accent px-2 py-0.5 hover:bg-accent/70">#{n}</button>
                    ))}
                </div>
            )}

            <section className="flex flex-col gap-1.5">
                <h3 className="text-xs font-medium uppercase text-muted-foreground">Timeline</h3>
                {history.map((h, i) => (
                    <div key={`${h.at}-${i}`} className="flex flex-col gap-0.5 text-sm">
                        <div className="flex items-center gap-2">
                            <StateIcon state={h.state} />
                            <span>{h.state.replace('_', ' ')}</span>
                            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{clock(h.at)}</span>
                        </div>
                        {h.reason !== null && <div className="pl-6 text-xs text-muted-foreground">{h.reason}</div>}
                    </div>
                ))}
                {!job.history && <div className="text-xs text-muted-foreground">{NO_HISTORY}</div>}
            </section>

            <section className="flex flex-col gap-1.5">
                <h3 className="text-xs font-medium uppercase text-muted-foreground">Runs</h3>
                {runs === null && <div className="text-xs text-muted-foreground">{NO_RUNS}</div>}
                {runs?.map((r, i) => (
                    <div key={`${r.startedAt}-${i}`} className="flex items-center gap-2 text-sm">
                        <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{r.stage} · {names[r.coworkerId] ?? r.coworkerId} · {r.status}</span>
                            <span className="text-xs tabular-nums text-muted-foreground">
                                {clock(r.startedAt)} – {r.endedAt === null ? 'running' : clock(r.endedAt)} · {r.tokensIn} in / {r.tokensOut} out
                            </span>
                        </div>
                        <button type="button" onClick={() => onOpenCoworker(r.coworkerId)} className="rounded border px-2 py-0.5 text-xs hover:bg-accent">Open</button>
                    </div>
                ))}
            </section>
        </div>
    )
}
