'use client'

import { useEffect, useState } from 'react'
import type { FactoryJobState, FactorySnapshot } from '@rerun/contracts'
import { JOB_STATE_VIEW } from './factory-state'
import { loaderView } from './factory-loader'

const NO_PICTURE = 'No picture from the Loader yet. The floor is playing its sample loop.'
const ENDED = ['merged', 'rejected', 'blocked', 'failed', 'returned'] as const

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour12: false })
const mmss = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{children}</dd>
        </div>
    )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="flex flex-col gap-1">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
            {children}
        </section>
    )
}

function StateIcon({ state }: { state: FactoryJobState }) {
    const v = JOB_STATE_VIEW[state]
    const Icon = v.icon
    return <Icon className="size-4 shrink-0" style={{ color: v.color }} aria-hidden />
}

export function FactoryLoader({ snapshot, now: fixedNow }: { snapshot: FactorySnapshot | null; now?: number }) {
    const [tick, setTick] = useState(() => Date.now())
    useEffect(() => {
        if (fixedNow !== undefined) return
        const id = setInterval(() => setTick(Date.now()), 1000)
        return () => clearInterval(id)
    }, [fixedNow])
    const now = fixedNow ?? tick

    if (snapshot === null) return <div className="p-4 text-sm text-muted-foreground">{NO_PICTURE}</div>

    const v = loaderView(snapshot, now)
    const empty = v.queued.length === 0 && v.waiting.length === 0

    return (
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
            <Section title="Loader">
                <div className="flex items-center gap-2 text-sm">
                    <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: v.alive.answering ? '#22c55e' : '#ef4444' }}
                        aria-hidden
                    />
                    <span>
                        {v.alive.answering
                            ? 'Answering'
                            : `Not answering: last beat ${Math.max(1, Math.floor(v.alive.ageMs / 60_000))} min ago`}
                    </span>
                </div>
                <dl className="flex flex-col gap-1">
                    <Fact label="Beat">Beat {v.alive.beat}</Fact>
                    <Fact label="Last beat">{clock(v.alive.lastBeatAt)}</Fact>
                </dl>
            </Section>

            <Section title="Queue">
                {empty && <div className="text-sm text-muted-foreground">Nothing queued or waiting</div>}
                {v.queued.map(q => (
                    <div key={q.issue} className="flex items-center gap-2 text-sm">
                        <StateIcon state="queued" />
                        <span className="shrink-0 tabular-nums text-muted-foreground">{q.position}.</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">#{q.issue}</span>
                        <span className="min-w-0 flex-1 truncate">{q.title}</span>
                    </div>
                ))}
                {v.waiting.map(w => (
                    <div key={w.issue} className="flex items-center gap-2 text-sm">
                        <StateIcon state="waiting" />
                        <span className="shrink-0 tabular-nums text-muted-foreground">#{w.issue}</span>
                        <span className="min-w-0 flex-1 truncate">{w.title}</span>
                        <span className="shrink-0 text-muted-foreground">
                            {w.waitsOn.length === 0
                                ? (w.reason ?? '')
                                : `waits on ${w.waitsOn.map(d => `#${d.issue}${d.state === null ? '' : ` (${d.state})`}`).join(', ')}`}
                        </span>
                    </div>
                ))}
            </Section>

            <Section title="Holds">
                {v.holds.length === 0 && <div className="text-sm text-muted-foreground">No hold</div>}
                <dl className="flex flex-col gap-1">
                    {v.holds.map(h => <Fact key={h.kind} label={h.kind}>{mmss(h.leftMs)}</Fact>)}
                </dl>
            </Section>

            <Section title="Pools">
                {v.pools.map(p => (
                    <div key={p.type} className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-3 text-sm font-medium">
                            <span>{p.type}</span>
                            <span className="tabular-nums">{p.out} / {p.allowed}</span>
                        </div>
                        <dl className="flex flex-col gap-1">
                            {p.coworkers.map(c => <Fact key={c.name} label={c.name}>{c.out} / {c.runs}</Fact>)}
                        </dl>
                    </div>
                ))}
            </Section>

            <Section title="Ended today">
                <dl className="flex flex-col gap-1">
                    {ENDED.map(k => <Fact key={k} label={k}>{v.ended[k]}</Fact>)}
                </dl>
            </Section>
        </div>
    )
}
