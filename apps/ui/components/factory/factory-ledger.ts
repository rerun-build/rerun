import type { FactoryDepartment, FactoryEpicKind, FactoryJob, FactoryJobState, FactorySnapshot } from '@moldwright/contracts'
import { isLocalToday } from './FactoryTasks'

export const DEPARTMENT_VIEW: Record<FactoryDepartment, { label: string; color: string }> = {
    design: { label: 'Design', color: '#ec4899' },
    database: { label: 'Database', color: '#f59e0b' },
    engine: { label: 'Engine', color: '#ef4444' },
    backend: { label: 'Backend services', color: '#3b82f6' },
    frontend: { label: 'Frontend', color: '#10b981' },
    tooling: { label: 'Dispatcher and tooling', color: '#8b5cf6' },
    docs: { label: 'Docs', color: '#64748b' },
}

export type LedgerSubtask = {
    stage: string
    who: string | null
    status: string
    steps: number | null
    startedAt: string
    endedAt: string | null
    tokens: number
    runId: string | null
}

export type LedgerTask = {
    issue: number
    title: string
    state: FactoryJobState
    enteredAt: string
    coworker: string | null
    department?: FactoryDepartment
    departments: FactoryDepartment[]
    needs: number[]
    critical: boolean
    subtasks: LedgerSubtask[]
}

export type LedgerLayer = { n: number; tasks: LedgerTask[] }

export type LedgerEpic = {
    issue: number | null
    title: string
    kind: FactoryEpicKind | null
    layers: LedgerLayer[]
    cycle: { issues: number[]; tasks: LedgerTask[] } | null
    progress: { merged: number; total: number }
    criticalPath: number[]
}

const byIssue = (a: { issue: number }, b: { issue: number }) => a.issue - b.issue

function subtasksOf(job: FactoryJob): LedgerSubtask[] {
    const runs = [...(job.runs ?? [])].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    const out: LedgerSubtask[] = runs.map((r) => ({
        stage: r.stage, who: r.coworkerId, status: r.status, steps: r.endedAt === null ? job.steps : null,
        startedAt: r.startedAt, endedAt: r.endedAt, tokens: r.tokensIn + r.tokensOut, runId: r.runId,
    }))
    for (const h of job.history ?? []) {
        if (h.state !== 'checks' && h.state !== 'merged') continue
        out.push({ stage: h.state === 'checks' ? 'checks' : 'merge', who: null, status: 'done', steps: null, startedAt: h.at, endedAt: null, tokens: 0, runId: null })
    }
    return out
}

function buildEpic(issue: number | null, title: string, kind: FactoryEpicKind | null, jobs: FactoryJob[]): LedgerEpic {
    const sorted = [...jobs].sort(byIssue)
    const byNum = new Map(sorted.map((j) => [j.issue, j]))
    const unmet = (j: FactoryJob) => j.dependsOn.filter((d, i, a) => a.indexOf(d) === i && byNum.has(d) && byNum.get(d)!.state !== 'merged' && d !== j.issue).sort((a, b) => a - b)
    const needsOf = new Map(sorted.map((j) => [j.issue, unmet(j)]))

    const layerOf = new Map<number, number>()
    let progress = true
    while (progress) {
        progress = false
        for (const j of sorted) {
            if (layerOf.has(j.issue)) continue
            const needs = needsOf.get(j.issue)!
            if (needs.every((n) => layerOf.has(n))) {
                layerOf.set(j.issue, 1 + Math.max(0, ...needs.map((n) => layerOf.get(n)!)))
                progress = true
            }
        }
    }

    const unlayered = sorted.filter((j) => !layerOf.has(j.issue))
    const reaches = (from: number, target: number): boolean => {
        const seen = new Set<number>()
        const stack = [...needsOf.get(from)!]
        while (stack.length) {
            const n = stack.pop()!
            if (n === target) return true
            if (seen.has(n)) continue
            seen.add(n)
            stack.push(...(needsOf.get(n) ?? []))
        }
        return false
    }
    const members = unlayered.filter((j) => reaches(j.issue, j.issue)).map((j) => j.issue)

    const len = new Map<number, number>()
    const live = sorted.filter((j) => layerOf.has(j.issue) && j.state !== 'merged').sort((a, b) => layerOf.get(a.issue)! - layerOf.get(b.issue)! || a.issue - b.issue)
    for (const j of live) len.set(j.issue, 1 + Math.max(0, ...needsOf.get(j.issue)!.map((n) => len.get(n) ?? 0)))
    const criticalPath: number[] = []
    if (live.length) {
        let tail = live.map((j) => j.issue).sort((a, b) => a - b).reduce((best, n) => (len.get(n)! > len.get(best)! ? n : best))
        criticalPath.unshift(tail)
        while (len.get(tail)! > 1) {
            const want = len.get(tail)! - 1
            tail = needsOf.get(tail)!.filter((n) => len.get(n) === want).sort((a, b) => a - b)[0]
            criticalPath.unshift(tail)
        }
    }
    const onPath = new Set(criticalPath)

    const task = (j: FactoryJob): LedgerTask => ({
        issue: j.issue, title: j.title, state: j.state, enteredAt: j.enteredAt, coworker: j.coworker, department: j.department,
        departments: j.departments ?? [], needs: needsOf.get(j.issue)!, critical: onPath.has(j.issue), subtasks: subtasksOf(j),
    })
    const layerNums = [...new Set(layerOf.values())].sort((a, b) => a - b)
    const layers = layerNums.map((n) => ({ n, tasks: sorted.filter((j) => layerOf.get(j.issue) === n).map(task) }))
    const cycleTasks = [...unlayered.filter((j) => members.includes(j.issue)), ...unlayered.filter((j) => !members.includes(j.issue))].map(task)
    return {
        issue, title, kind, layers,
        cycle: unlayered.length ? { issues: members, tasks: cycleTasks } : null,
        progress: { merged: sorted.filter((j) => j.state === 'merged').length, total: sorted.length },
        criticalPath,
    }
}

export function buildLedger(snapshot: FactorySnapshot): LedgerEpic[] {
    const epics = new Map<number, { title: string; kind: FactoryEpicKind | null }>()
    for (const e of snapshot.epics ?? []) epics.set(e.issue, { title: e.title, kind: e.kind })
    for (const j of snapshot.jobs) if (j.parent !== null && !epics.has(j.parent)) epics.set(j.parent, { title: `#${j.parent}`, kind: null })
    const out = [...epics.entries()].sort((a, b) => a[0] - b[0])
        .map(([issue, e]) => buildEpic(issue, e.title, e.kind, snapshot.jobs.filter((j) => j.parent === issue)))
        .filter((e) => e.progress.total > 0 || (snapshot.epics ?? []).some((x) => x.issue === e.issue))
    const loose = snapshot.jobs.filter((j) => j.parent === null)
    if (loose.length) out.push(buildEpic(null, 'No epic', null, loose))
    return out
}

export type LedgerFilter = 'running' | 'waiting' | 'problems' | 'doneToday' | 'wave' | { department: FactoryDepartment }

const RUNNING = new Set<FactoryJobState>(['building', 'reviewing', 'proving', 'fixing', 'checks'])
const WAITING = new Set<FactoryJobState>(['waiting', 'queued', 'review_wait', 'proof_wait', 'fix_wait'])
const PROBLEMS = new Set<FactoryJobState>(['blocked', 'failed', 'returned', 'rejected'])

export function filterLedger(epics: LedgerEpic[], filter: LedgerFilter | null, now: number): LedgerEpic[] {
    if (filter === null) return epics
    const out: LedgerEpic[] = []
    for (const e of epics) {
        let match: (t: LedgerTask) => boolean
        if (filter === 'running') match = (t) => RUNNING.has(t.state)
        else if (filter === 'waiting') match = (t) => WAITING.has(t.state)
        else if (filter === 'problems') match = (t) => PROBLEMS.has(t.state)
        else if (filter === 'doneToday') match = (t) => t.state === 'merged' && doneToday(t, now)
        else if (filter === 'wave') {
            const wave = e.layers.find((l) => l.tasks.some((t) => t.state !== 'merged'))
            const set = new Set(wave?.tasks.map((t) => t.issue) ?? [])
            match = (t) => set.has(t.issue)
        } else {
            const d = filter.department
            match = (t) => t.department === d || t.departments.includes(d)
        }
        const layers = e.layers.map((l) => ({ n: l.n, tasks: l.tasks.filter(match) })).filter((l) => l.tasks.length)
        const cycleTasks = e.cycle ? e.cycle.tasks.filter(match) : []
        if (!layers.length && !cycleTasks.length) continue
        out.push({ ...e, layers, cycle: e.cycle && cycleTasks.length ? { issues: e.cycle.issues, tasks: cycleTasks } : null })
    }
    return out
}

const doneToday = (t: LedgerTask, now: number) => t.state === 'merged' && isLocalToday(t.enteredAt, now)

export type ChipCounts = { running: number; waiting: number; problems: number; doneToday: number; byDepartment: Partial<Record<FactoryDepartment, number>> }

export function chipCounts(epics: LedgerEpic[], now: number): ChipCounts {
    const c: ChipCounts = { running: 0, waiting: 0, problems: 0, doneToday: 0, byDepartment: {} }
    for (const t of allTasks(epics)) {
        if (RUNNING.has(t.state)) c.running++
        if (WAITING.has(t.state)) c.waiting++
        if (PROBLEMS.has(t.state)) c.problems++
        if (t.state === 'merged' && doneToday(t, now)) c.doneToday++
        for (const d of new Set([...(t.department ? [t.department] : []), ...t.departments])) c.byDepartment[d] = (c.byDepartment[d] ?? 0) + 1
    }
    return c
}

function allTasks(epics: LedgerEpic[]): LedgerTask[] {
    return epics.flatMap((e) => [...e.layers.flatMap((l) => l.tasks), ...(e.cycle?.tasks ?? [])])
}

export function chainOf(epics: LedgerEpic[], issue: number): { waitsOn: number[]; waitedBy: number[]; stuck: boolean } {
    const tasks = new Map(allTasks(epics).map((t) => [t.issue, t]))
    const walk = (start: number, next: (n: number) => number[]) => {
        const seen = new Set<number>()
        const stack = [...next(start)]
        while (stack.length) {
            const n = stack.pop()!
            if (seen.has(n) || n === start) continue
            seen.add(n)
            stack.push(...next(n))
        }
        return [...seen].sort((a, b) => a - b)
    }
    const needs = (n: number) => tasks.get(n)?.needs ?? []
    const waiters = (n: number) => [...tasks.values()].filter((t) => t.needs.includes(n)).map((t) => t.issue)
    const waitsOn = walk(issue, needs)
    const waitedBy = walk(issue, waiters)
    const stuck = [issue, ...waitsOn].some((n) => { const t = tasks.get(n); return !!t && PROBLEMS.has(t.state) })
    return { waitsOn, waitedBy, stuck }
}
