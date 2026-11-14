'use client'

import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { FactoryJob, FactorySnapshot } from '@rerun/contracts'
import { cn } from '@/lib/utils'
import { JOB_STATE_VIEW, groupOf, type JobGroup } from './factory-state'

const GROUP_ORDER: JobGroup[] = ['active', 'waiting', 'ended']
const GROUP_LABEL: Record<JobGroup, string> = { active: 'Active', waiting: 'Waiting', ended: 'Ended today' }
const IDLE_TEXT = (merged: number) => `The line is idle. ${merged} merged today.`
const REASON_STATES = new Set(['blocked', 'failed', 'returned'])

export function formatInState(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000))
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ${s % 60}s`
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function FactoryTasks({ jobs, repo, endedToday, selected, onSelect }: { jobs: FactoryJob[]; repo: string; endedToday: FactorySnapshot['endedToday']; selected: number | null; onSelect: (issue: number) => void }) {
    const [now, setNow] = useState(() => Date.now())
    const [filter, setFilter] = useState<JobGroup | null>(null)
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
    }, [])

    const byGroup: Record<JobGroup, FactoryJob[]> = { active: [], waiting: [], ended: [] }
    for (const j of jobs) byGroup[groupOf(j.state)].push(j)
    const idle = byGroup.active.length === 0 && byGroup.waiting.length === 0
    const shown = GROUP_ORDER.filter((g) => byGroup[g].length > 0 && (filter === null || filter === g))

    return (
        <div className="flex h-full flex-col gap-2 overflow-y-auto p-3 text-sm">
            <div className="flex gap-1.5">
                {GROUP_ORDER.map((g) => (
                    <button key={g} type="button" data-chip aria-pressed={filter === g} onClick={() => setFilter(filter === g ? null : g)}
                        className={cn('rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground', filter === g && 'bg-accent text-foreground')}>
                        {GROUP_LABEL[g]} {byGroup[g].length}
                    </button>
                ))}
            </div>
            {idle && <p className="text-muted-foreground">{IDLE_TEXT(endedToday.merged)}</p>}
            {shown.map((g) => (
                <section key={g} className="flex flex-col gap-1">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{GROUP_LABEL[g]}</h3>
                    {byGroup[g].map((j) => {
                        const view = JOB_STATE_VIEW[j.state]
                        const Icon = view.icon
                        const who = j.coworker && j.copy ? `${j.coworker} · ${j.copy}` : null
                        const isSel = selected === j.issue
                        return (
                            <div key={j.issue} data-row role="button" tabIndex={0} aria-pressed={isSel}
                                onClick={() => onSelect(j.issue)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(j.issue) } }}
                                className={cn('flex cursor-pointer flex-col rounded-md border border-border bg-card px-2 py-1.5 hover:bg-accent/50', isSel && 'border-primary bg-accent')}>
                                <div className="flex items-center gap-2">
                                    <Icon className={cn('size-4 shrink-0', view.dim && 'opacity-50')} style={{ color: view.color }} />
                                    <span className="shrink-0 text-muted-foreground">#{j.issue}</span>
                                    <span className="min-w-0 flex-1 truncate">{j.title}</span>
                                    {who && <span className="shrink-0 text-xs text-muted-foreground">{who}</span>}
                                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatInState(now - Date.parse(j.enteredAt))}</span>
                                    {j.round !== null && j.round >= 2 && <span className="shrink-0 rounded-full bg-accent px-1.5 text-xs">R{j.round}</span>}
                                    {j.pr !== null && (
                                        <a href={`https://github.com/${repo}/pull/${j.pr}`} target="_blank" rel="noreferrer" aria-label={`PR ${j.pr}`}
                                            onClick={(e) => e.stopPropagation()} className="shrink-0 text-muted-foreground hover:text-foreground">
                                            <ExternalLink className="size-3.5" />
                                        </a>
                                    )}
                                </div>
                                {REASON_STATES.has(j.state) && j.reason !== null && <div className="pl-6 text-xs text-muted-foreground">{j.reason}</div>}
                            </div>
                        )
                    })}
                </section>
            ))}
        </div>
    )
}
