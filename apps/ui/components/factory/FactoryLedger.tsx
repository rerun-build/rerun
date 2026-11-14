'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { FactoryEpicKind } from '@rerun/contracts'
import { cn } from '@/lib/utils'
import { formatEndedAt, formatInState } from './FactoryTasks'
import { DEPARTMENT_VIEW, chainOf, type LedgerEpic, type LedgerTask } from './factory-ledger'
import { JOB_STATE_VIEW } from './factory-state'

const KIND_LABEL: Record<FactoryEpicKind, string> = {
    feature: 'feature', review_fix: 'review + fix', fix: 'fix', upgrade: 'upgrade', refactor: 'refactor', research: 'research', other: 'other',
}

function TaskRow({ task, selected, onSelect, now, chain }: {
    task: LedgerTask; selected: number | null; onSelect: (issue: number) => void; now: number
    chain: { waitsOn: Set<number>; waitedBy: Set<number>; stuck: boolean } | null
}) {
    const [open, setOpen] = useState(false)
    const view = JOB_STATE_VIEW[task.state]
    const Icon = view.icon
    const inChain = chain && (chain.waitsOn.has(task.issue) || chain.waitedBy.has(task.issue) || task.issue === selected)
    const chainKind = chain ? (chain.waitsOn.has(task.issue) ? 'waits' : chain.waitedBy.has(task.issue) ? 'waited' : undefined) : undefined
    const dep = task.department
    return (
        <div>
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    data-task={task.issue}
                    data-critical={task.critical ? '' : undefined}
                    data-chain={chainKind}
                    data-stuck={inChain && chain?.stuck ? '' : undefined}
                    onClick={() => onSelect(task.issue)}
                    className={cn('flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted', selected === task.issue && 'bg-muted', task.critical && 'font-medium')}
                >
                    <Icon className={cn('size-3.5 shrink-0', view.dim && 'opacity-60')} style={{ color: view.color }} />
                    <span className="truncate">#{task.issue} {task.title}</span>
                    {task.coworker && <span className="text-muted-foreground">{task.coworker}</span>}
                    {task.needs.length > 0 && <span className="text-muted-foreground">needs {task.needs.map((n) => `#${n}`).join(', ')}</span>}
                    {dep && <span className="rounded px-1 text-white" style={{ background: DEPARTMENT_VIEW[dep].color }}>{DEPARTMENT_VIEW[dep].label}</span>}
                    {task.departments.map((d) => (
                        <span key={d} className="rounded px-1 text-[10px] text-white" style={{ background: DEPARTMENT_VIEW[d].color }}>{DEPARTMENT_VIEW[d].label}</span>
                    ))}
                </button>
                {task.subtasks.length > 0 && (
                    <button type="button" aria-label={`Subtasks of #${task.issue}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded p-1 hover:bg-muted">
                        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                    </button>
                )}
            </div>
            {open && (
                <ul className="ml-8 text-[11px] text-muted-foreground">
                    {task.subtasks.map((s, i) => (
                        <li key={i} data-subtasks="">
                            {s.stage} · {s.who ?? 'line'} · {s.status}{s.steps !== null ? ` · ${s.steps} steps` : ''} · {formatEndedAt(s.startedAt, now)}
                            {s.endedAt ? ` · ${formatInState(Date.parse(s.endedAt) - Date.parse(s.startedAt))}` : ''}{s.tokens ? ` · ${s.tokens} tokens` : ''}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

export function FactoryLedger({ epics, selected, onSelect, now }: { epics: LedgerEpic[]; selected: number | null; onSelect: (issue: number) => void; now: number }) {
    if (epics.length === 0) return <p className="text-xs text-muted-foreground">No tasks</p>
    const c = selected !== null ? chainOf(epics, selected) : null
    const chain = c ? { waitsOn: new Set(c.waitsOn), waitedBy: new Set(c.waitedBy), stuck: c.stuck } : null
    const row = (t: LedgerTask) => <TaskRow key={t.issue} task={t} selected={selected} onSelect={onSelect} now={now} chain={chain} />
    return (
        <div className="flex flex-col gap-3">
            {epics.map((e) => (
                <section key={e.issue ?? 'none'} data-epic={e.issue ?? 'none'}>
                    <header className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{e.title}</span>
                        {e.kind && <span className="rounded border px-1 text-[10px] font-normal">{KIND_LABEL[e.kind]}</span>}
                        <span className="ml-auto text-xs text-muted-foreground">{e.progress.merged} / {e.progress.total}</span>
                    </header>
                    {e.layers.map((l) => (
                        <div key={l.n} className="mt-1">
                            <h4 data-layer={l.n} className="text-[11px] uppercase text-muted-foreground">Layer {l.n}</h4>
                            {l.tasks.map(row)}
                        </div>
                    ))}
                    {e.cycle && (
                        <div role="alert" data-cycle="" className="mt-1 rounded border border-red-500 p-1 text-xs text-red-600">
                            <div>Cycle: {e.cycle.issues.map((n) => `#${n}`).join(', ')}</div>
                            {e.cycle.tasks.map(row)}
                        </div>
                    )}
                </section>
            ))}
        </div>
    )
}
