import { agentTileStyle, buddyColor, buddyEyes, buddyMouth, type BuddyLook, type Tile, type TileLink } from '@rerun/ui/iso-grid'
import type { FactoryJob, FactorySnapshot } from '@rerun/contracts'
import { BOSS, BOSS_ID, type CabinetView, type Cell, COPY_CELLS, FEATURE_CELLS, type FactoryFrame, PLANNER_CELLS, PLAN_TANK, type PlanView, type PodView, type SlotView, STATUS_COLOR, factoryScene } from './factory-scene'

export type SnapshotFrame = FactoryFrame & { blocked: { issue: number; reason: string }[]; cracked: number[]; notAnswering: boolean; lastBeatMs: number }

const BEAT_MS = 30_000
const KEEP = ['Delegator', 'code', 'LARRY', 'LINUS', 'BRUCE', 'search', 'DIETER', 'rejects']
const QUIET = '#8ea2ff'
const RIDE_MS = 1_800
const STAGGER_MS = 600
const seen = new Map<number, number>()
const rides = new Map<string, { parent: number; start: number }>()
export const resetRides = () => { seen.clear(); rides.clear() }
const clamp = (x: number) => Math.max(0, Math.min(1, x))
const dedupe = (xs: string[]) => xs.filter((x, i) => i === 0 || x !== xs[i - 1])

const lookOf = (id: string): BuddyLook => ({ eyes: buddyEyes(id, {}), mouth: buddyMouth(id, {}), color: buddyColor(id, {}) })
const workStyle = (name: string, id: string) => {
    const look = lookOf(id)
    return { ...agentTileStyle('idle', name), glow: `color-mix(in srgb, ${look.color} 60%, transparent)`, buddy: { ...look, mood: 'working' as const, ownColor: true } }
}

export function sceneFromSnapshot(snapshot: FactorySnapshot, now: number): SnapshotFrame {
    const base = factoryScene(0, now)
    const tileOf = (id: string) => base.tiles.find(t => t.id === id)!
    const ids = new Map<string, string>()
    for (const pool of snapshot.pools) for (const c of pool.coworkers) if (c.id && !ids.has(c.name)) ids.set(c.name, c.id)

    const copyCells: Record<string, { room: string; cells: Cell[] }> = {
        code: { room: 'build', cells: COPY_CELLS.code },
        LINUS: { room: 'review', cells: COPY_CELLS.LINUS },
        search: { room: 'studio', cells: COPY_CELLS.search },
    }

    const live = snapshot.holds.filter(h => Date.parse(h.until) > now)
    const held = live.length > 0
    const holdLeftMs = held ? Math.max(...live.map(h => Date.parse(h.until) - now)) : 0
    const lastBeatMs = now - Date.parse(snapshot.madeAt)
    const notAnswering = lastBeatMs > 2 * BEAT_MS

    const jobs = snapshot.jobs
    const blocked: { issue: number; reason: string }[] = []
    const cracked: number[] = []
    const copyTiles: Tile[] = []
    const copyLinks: TileLink[] = []
    const pods: PodView[] = []
    const counts = { queued: 0, building: 0, review: 0, checks: 0, merged: 0, runs: 0 }
    let rejects = 0

    const holderOf = (job: FactoryJob, who: string): string => {
        const slots = copyCells[who]
        const cell = slots && job.copy && job.copy >= 2 ? slots.cells[job.copy - 2] : undefined
        if (!slots || !cell) return who
        const id = `${who}-copy-${job.issue}`
        const own = tileOf(who)
        copyTiles.push({
            id, position: cell, span: 2, containerId: slots.room, selectable: false, draggable: false, justPlaced: true,
            style: { ...own.style, ...workStyle(who, ids.get(who) ?? who), opacity: 0.55 }, ariaLabel: `${who}, a copy`,
        })
        copyLinks.push({ source: who, target: id, variant: 'trace', color: who === 'LINUS' ? STATUS_COLOR.review : who === 'code' ? STATUS_COLOR.build : '#f472b6' })
        return id
    }

    let queue = 0
    for (const job of jobs) {
        const since = now - Date.parse(job.enteredAt)
        const steps = job.steps ?? 0
        const pod = (path: string[], travel: number, band: PodView['band'], state: PodView['state'], level: number, extra: Partial<PodView> = {}) =>
            pods.push({ id: `pod-${job.issue}`, issue: job.issue, title: job.title, path, travel, queue: 0, level, band, state, scan: 0, since: Date.parse(job.enteredAt), holder: job.coworker ? (job.copy ? `${job.coworker} · ${job.copy}` : job.coworker) : undefined, pr: job.pr ?? undefined, ...extra })
        switch (job.state) {
            case 'waiting':
            case 'queued':
                counts.queued++
                pod(['Delegator', 'code'], 0, 'build', held ? 'held' : 'queued', 0, { queue: queue++ })
                break
            case 'building':
                counts.building++
                counts.runs++
                pod(dedupe(['Delegator', 'code', job.coworker === 'LARRY' ? 'LARRY' : holderOf(job, 'code')]), clamp(since / 2_240), 'build', 'working', 0.4)
                break
            case 'review_wait':
            case 'proof_wait':
                counts.review++
                pod(['code', 'LINUS'], 0.5, 'review', 'queued', 0.4)
                break
            case 'reviewing':
            case 'proving':
                counts.review++
                counts.runs++
                pod(dedupe(['code', 'LINUS', job.coworker === 'BRUCE' ? 'BRUCE' : holderOf(job, 'LINUS')]), clamp(since / 2_240), 'review', 'working', Math.min(0.7, 0.4 + 0.05 * steps), { scan: clamp(since / 3_000) % 1 })
                break
            case 'fix_wait':
                counts.building++
                pod(['LINUS', 'code'], 0.5, 'build', 'queued', 0.5)
                break
            case 'fixing':
                counts.building++
                counts.runs++
                pod(['LINUS', 'code'], clamp(since / 2_240), 'build', 'fixing', Math.min(0.6, 0.5 + 0.02 * steps))
                break
            case 'checks':
                counts.checks++
                counts.runs++
                pod(['LINUS', 'Delegator'], clamp(since / 2_240), 'checks', 'checks', 0.8)
                break
            case 'blocked': {
                blocked.push({ issue: job.issue, reason: job.reason ?? '' })
                break
            }
            case 'merged':
                counts.merged++
                break
            case 'rejected':
                rejects++
                break
            case 'failed':
            case 'returned':
                cracked.push(job.issue)
                break
        }
    }

    for (const p of snapshot.planning ?? []) {
        const before = seen.get(p.parent) ?? p.filed
        for (let n = before + 1; n <= p.filed; n++) rides.set(`${p.parent}-${n}`, { parent: p.parent, start: now + (n - before - 1) * STAGGER_MS })
        seen.set(p.parent, p.filed)
    }
    for (const [key, r] of rides) {
        const age = now - r.start
        if (age >= RIDE_MS) rides.delete(key)
        else if (age >= 0 && r.parent === snapshot.planning?.at(-1)?.parent) pods.push({ id: `plan-ride-${key}`, issue: r.parent, title: `filed for #${r.parent}`, path: [`plan-${r.parent}`, 'Delegator'], travel: clamp(age / RIDE_MS), queue: 0, level: 0, band: 'build', state: 'working', scan: 0, since: r.start })
    }

    const parents = [...new Set(jobs.map(j => j.parent).filter((p): p is number => p !== null))].sort((a, b) => a - b).slice(0, FEATURE_CELLS.length)
    const slotOf = (j: FactoryJob): SlotView => {
        const done = j.state === 'merged' || j.state === 'rejected'
        return { issue: j.issue, state: j.state === 'merged' ? 'merged' : j.state === 'rejected' ? 'rejected' : 'empty', arriving: done ? 1 : 0 }
    }
    const cabinets: CabinetView[] = parents.map((p, i) => {
        const mine = jobs.filter(j => j.parent === p)
        return { issue: p, title: '', tasks: mine.map(j => j.issue), at: FEATURE_CELLS[i], slots: mine.map(slotOf) }
    })
    const cabTiles: Tile[] = cabinets.map(c => ({
        id: `cab-${c.issue}`, position: c.at, span: 2, containerId: 'stock', selectable: false, draggable: false,
        style: { color: '#1b2140', sheen: true, depth: 2 }, ariaLabel: `Feature #${c.issue}${c.title ? ' ' + c.title : ''}: ${c.slots.filter(s => s.state !== 'empty').length} of ${c.slots.length}`,
    }))

    const desk = snapshot.planning?.at(-1)
    const runners = new Map<string, { id: string; name: string }>()
    for (const p of snapshot.planning ?? []) for (const c of p.coworkers) runners.set(c.id, c)
    const room = { span: 2, containerId: 'planning', selectable: false, draggable: false }
    const planTiles: Tile[] = [
        { ...room, id: 'Boss', position: BOSS, style: runners.has(BOSS_ID) ? workStyle('Boss', BOSS_ID) : { ...agentTileStyle('idle', 'Boss'), buddy: lookOf(BOSS_ID) }, ariaLabel: 'Boss' },
        ...[...runners.values()].filter(c => c.id !== BOSS_ID).slice(0, PLANNER_CELLS.length).map((c, i) => ({ ...room, id: `planner-${c.id.slice(0, 8)}`, position: PLANNER_CELLS[i], style: workStyle(c.name, c.id), ariaLabel: c.name })),
        ...(desk ? [{ ...room, id: `plan-${desk.parent}`, position: PLAN_TANK, style: { color: '#1b2140', sheen: true, depth: 2 }, ariaLabel: `Planning #${desk.parent} ${desk.title}: ${desk.filed} of ${desk.children} filed` }] : []),
    ]
    const plans: PlanView[] = desk ? [{ parent: desk.parent, title: desk.title, children: desk.children, filed: desk.filed }] : []

    const out = new Map<string, number>()
    for (const pool of snapshot.pools) for (const c of pool.coworkers) out.set(c.name, c.out)
    const tiles: Tile[] = base.tiles.filter(t => KEEP.includes(t.id)).map(tile => {
        if (tile.id === 'rejects') return { ...tile, ariaLabel: `Reject bin: ${rejects}` }
        if (tile.id === 'Delegator') {
            const state = held ? 'waiting_human' : counts.queued + counts.checks > 0 ? 'working' : 'idle'
            return { ...tile, style: { ...agentTileStyle(state, 'Delegator'), buddy: tile.style.buddy, label: 'Loader', shape: 'capsule' as const, ...(held ? { badge: 'lock' as const } : {}) } }
        }
        const working = (out.get(tile.id) ?? 0) > 0
        const id = ids.get(tile.id) ?? tile.id
        return { ...tile, style: working ? workStyle(tile.id, id) : { ...agentTileStyle('idle', tile.id), buddy: lookOf(id) } }
    })

    const lineColor = new Map<string, string>()
    for (const p of pods) {
        const color = p.state === 'checks' ? STATUS_COLOR.checks : p.state === 'fixing' ? STATUS_COLOR.fixing : p.state === 'working' ? STATUS_COLOR[p.band === 'review' ? 'review' : 'build'] : null
        if (!color) continue
        for (let i = 1; i < p.path.length; i++) { lineColor.set(`${p.path[i - 1]}>${p.path[i]}`, color); lineColor.set(`${p.path[i]}>${p.path[i - 1]}`, color) }
    }
    const belts: TileLink[] = [
        ...base.links.filter(l => KEEP.includes(l.source) && KEEP.includes(l.target) && l.variant === 'belt'),
        ...cabinets.map(c => ({ source: 'Delegator', target: `cab-${c.issue}`, variant: 'belt' as const, color: QUIET })),
        ...(desk ? [{ source: `plan-${desk.parent}`, target: 'Delegator', variant: 'belt' as const, color: QUIET }] : []),
    ].map(l => ({ ...l, color: held ? STATUS_COLOR.held : lineColor.get(`${l.source}>${l.target}`) ?? QUIET, still: !lineColor.has(`${l.source}>${l.target}`), chevrons: true }))

    return {
        containers: base.containers,
        tiles: [...tiles, ...copyTiles, ...cabTiles, ...planTiles],
        links: [...belts, ...copyLinks],
        toasts: [],
        pods, cabinets, plans, rejects, held, holdLeftMs, counts,
        blocked, cracked, notAnswering, lastBeatMs,
    }
}
