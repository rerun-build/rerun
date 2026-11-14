import type { FactoryJobState, FactorySnapshot, FactoryWorkerType } from '@rerun/contracts'

export const BEAT_MS = 30_000 // same as from-snapshot.ts

export type LoaderView = {
    alive: { beat: number; lastBeatAt: string; ageMs: number; answering: boolean }
    waiting: { issue: number; title: string; waitsOn: { issue: number; state: FactoryJobState | null }[]; reason: string | null }[]
    queued: { position: number; issue: number; title: string }[]
    holds: { kind: string; leftMs: number }[]
    pools: { type: FactoryWorkerType; allowed: number; out: number; coworkers: { name: string; runs: number; out: number }[] }[]
    ended: FactorySnapshot['endedToday']
    endedTotal: number
}

export function loaderView(snapshot: FactorySnapshot, now: number): LoaderView {
    const ageMs = now - Date.parse(snapshot.madeAt)
    const stateOf = new Map(snapshot.jobs.map(j => [j.issue, j.state]))
    return {
        alive: { beat: snapshot.beat, lastBeatAt: snapshot.madeAt, ageMs, answering: ageMs <= 2 * BEAT_MS },
        waiting: snapshot.jobs
            .filter(j => j.state === 'waiting')
            .map(j => ({
                issue: j.issue,
                title: j.title,
                waitsOn: j.dependsOn.map(d => ({ issue: d, state: stateOf.get(d) ?? null })),
                reason: j.reason,
            })),
        queued: snapshot.jobs
            .filter(j => j.state === 'queued')
            .map((j, i) => ({ position: i + 1, issue: j.issue, title: j.title })),
        holds: snapshot.holds
            .map(h => ({ kind: h.kind, leftMs: Date.parse(h.until) - now }))
            .filter(h => h.leftMs > 0)
            .sort((a, b) => b.leftMs - a.leftMs),
        pools: snapshot.pools.map(p => ({
            type: p.type,
            allowed: p.coworkers.reduce((n, c) => n + c.runs, 0),
            out: p.coworkers.reduce((n, c) => n + c.out, 0),
            coworkers: p.coworkers.map(c => ({ name: c.name, runs: c.runs, out: c.out })),
        })),
        ended: snapshot.endedToday,
        endedTotal: Object.values(snapshot.endedToday).reduce((n, v) => n + v, 0),
    }
}
