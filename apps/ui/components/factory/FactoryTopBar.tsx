'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FactoryDepartment, FactorySnapshot } from '@moldwright/contracts'
import { cn } from '@/lib/utils'
import { FactoryBucket } from './FactoryBucket'
import { FactoryInspector } from './FactoryInspector'
import { FactoryLedger } from './FactoryLedger'
import { SAMPLE_TEXT } from './FactoryTasks'
import { type Bucket } from './factory-bucket'
import { DEPARTMENT_VIEW, buildLedger, chipCounts, filterLedger, type ChipCounts, type LedgerFilter } from './factory-ledger'

const MAIN_CHIPS: { key: 'running' | 'waiting' | 'problems' | 'doneToday'; label: string }[] = [
    { key: 'running', label: 'Running' },
    { key: 'waiting', label: 'Waiting' },
    { key: 'problems', label: 'Problems' },
    { key: 'doneToday', label: 'Done today' },
]

const sameFilter = (a: LedgerFilter | null, b: LedgerFilter) =>
    a !== null && (typeof a === 'string' || typeof b === 'string' ? a === b : a.department === b.department)

function Chip({ name, label, count, filter, active, onPress, color }: {
    name: string; label: string; count?: number; filter: LedgerFilter; active: boolean; onPress: (f: LedgerFilter) => void; color?: string
}) {
    return (
        <button
            type="button"
            data-chip={name}
            aria-pressed={active}
            onClick={() => onPress(filter)}
            className={cn('flex items-center gap-1 rounded-full border px-3 py-1 text-xs hover:bg-accent', active ? 'border-foreground/40 bg-accent font-medium' : 'border-border/60 text-muted-foreground')}
        >
            {color && <span className="size-2 rounded-full" style={{ background: color }} />}
            {label}{count !== undefined ? ` ${count}` : ''}
        </button>
    )
}

export function FactoryTopBar({ snapshot, selected, onSelect, names, onOpenCoworker, bucket = null, onBucket }: {
    snapshot: FactorySnapshot | null
    selected: number | null
    onSelect: (issue: number | null) => void
    names: Record<string, string>
    onOpenCoworker: (coworkerId: string) => void
    bucket?: Bucket | null
    onBucket?: (bucket: Bucket | null) => void
}) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
    }, [])
    const [filter, setFilter] = useState<LedgerFilter | null>(null)
    const open = snapshot !== null && (filter !== null || selected !== null || bucket !== null)
    const rootRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const onDown = (e: Event) => {
            if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return
            setFilter(null)
            onSelect(null)
            onBucket?.(null)
        }
        document.addEventListener('pointerdown', onDown)
        return () => document.removeEventListener('pointerdown', onDown)
    }, [open, onSelect, onBucket])

    const [shown, setShown] = useState(false)
    useEffect(() => {
        if (!open) { setShown(false); return }
        const id = requestAnimationFrame(() => setShown(true))
        return () => cancelAnimationFrame(id)
    }, [open])

    const epics = useMemo(() => (snapshot ? buildLedger(snapshot) : []), [snapshot])
    const counts: ChipCounts = useMemo(() => chipCounts(epics, now), [epics, now])
    const shownEpics = useMemo(() => filterLedger(epics, filter, now), [epics, filter, now])
    const press = (f: LedgerFilter) => {
        onBucket?.(null)
        setFilter(cur => (sameFilter(cur, f) ? null : f))
    }

    if (!snapshot) return <div data-topbar className="relative w-full text-xs text-muted-foreground">{SAMPLE_TEXT}</div>

    const job = snapshot.jobs.find(j => j.issue === selected) ?? null
    const departments = (Object.keys(counts.byDepartment) as FactoryDepartment[]).filter(d => (counts.byDepartment[d] ?? 0) > 0)
    return (
        <div ref={rootRef} data-topbar className="relative w-full">
            <div className="flex flex-wrap items-center justify-center gap-2">
                {MAIN_CHIPS.map(c => (
                    <Chip key={c.key} name={c.key} label={c.label} count={counts[c.key]} filter={c.key} active={sameFilter(filter, c.key)} onPress={press} />
                ))}
            </div>
            {open && (
                <div
                    data-dropdown
                    style={{ maxHeight: 'var(--factory-drop-max)' }}
                    className={cn(
                        'absolute inset-x-0 top-full mt-3 overflow-y-auto rounded-2xl border border-border/60 bg-background/95 p-3 shadow-[0_8px_40px_rgba(0,0,0,0.12)] backdrop-blur-xl',
                        'transition-[opacity,transform] duration-200 motion-reduce:transition-none',
                        shown ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0',
                    )}
                >
                    {selected !== null ? (
                        <div className="flex flex-col gap-2">
                            <button type="button" onClick={() => onSelect(null)} className="self-start rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">Back to the list</button>
                            <FactoryInspector job={job} jobs={snapshot.jobs} repo={snapshot.repo} names={names} onSelect={onSelect} onOpenCoworker={onOpenCoworker} />
                        </div>
                    ) : bucket !== null ? (
                        <FactoryBucket bucket={bucket} jobs={snapshot.jobs} repo={snapshot.repo} names={names} now={now} onSelect={onSelect} />
                    ) : (
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <Chip name="wave" label="This wave" filter="wave" active={sameFilter(filter, 'wave')} onPress={press} />
                                {departments.map(d => (
                                    <Chip key={d} name={d} label={DEPARTMENT_VIEW[d].label} count={counts.byDepartment[d]} filter={{ department: d }} active={sameFilter(filter, { department: d })} onPress={press} color={DEPARTMENT_VIEW[d].color} />
                                ))}
                            </div>
                            <FactoryLedger epics={shownEpics} selected={selected} onSelect={onSelect} now={now} />
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
