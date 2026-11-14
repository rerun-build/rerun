// The factory as a production line on a Rerun board (docs/research/2026-11-14-factory-world/SPEC.md).
// Coworkers are the board's 2x2 buddies; a copy is the same buddy, see-through. A task is a glass sphere
// riding the belts between them and filling with its progress; a review is a scanner gate that passes
// it on, sends it back for a fix, or turns a defect into the reject bin; a finished task pours into its
// feature's sphere. The layout is below, at BOXES.
// `factoryScene(t)` is a pure function of the time in the loop.
// shortcut: the jobs are a fixed sample loop; the real page feeds the delegator's snapshot instead.

import { agentTileStyle, type BuddyLook, type Container, type Tile, type TileLink, type TileResultItem, type TileToast } from '@rerun/ui/iso-grid'

export type Cell = { col: number; row: number }

export const LOOP_MS = 84_000
const HOLD = { from: 46_000, to: 56_000 }
const TRANSIT_MS = 1_400
const SHAKE_MS = 700
const SLIDE_MS = 900

// The floor reads left to right: the Loader sends to `code` in Build, `code` hands down to LINUS in
// Review, LINUS sends back to the Loader through the open lane between the boxes, and the Loader fills
// the feature spheres in Stock below it. Every object has at least two free cells around it, and the
// copies sit straight out from or on a diagonal of their coworker, three at most to a face, so every
// line is straight or a single bend and none crosses another (link-routes.test.ts holds this).
const box = (id: string, label: string, col_start: number, row_start: number, col_end: number, row_end: number): Container =>
    ({ id, label, color: '#ffffff', col_start, row_start, col_end, row_end })
const BOXES: Container[] = [
    box('dispatch', 'Loader', 4, 6, 10, 11),
    box('build', 'Build', 17, 0, 37, 19),
    box('stock', 'Stock', 0, 14, 10, 20),
    box('review', 'Review', 17, 21, 29, 30),
    box('studio', 'Research & design', 0, 22, 10, 31),
]

export const LOADER: Cell = { col: 7, row: 9 }
export const CODE: Cell = { col: 22, row: 9 }
// The cells a copy of a coworker takes, in the order copies are made.
export const COPY_CELLS = {
    code: [{ col: 18, row: 5 }, { col: 22, row: 1 }, { col: 25, row: 4 }, { col: 30, row: 5 }, { col: 34, row: 9 }, { col: 26, row: 13 }],
    LINUS: [{ col: 26, row: 23 }, { col: 22, row: 27 }],
    search: [{ col: 7, row: 24 }],
} satisfies Record<string, Cell[]>
const LARRY: Cell = { col: 26, row: 17 }
export const LINUS: Cell = { col: 22, row: 23 }
const BRUCE: Cell = { col: 26, row: 27 }
// The reject bin: beside the scanners, with free floor between it and every coworker and belt.
const REJECT_BIN: Cell = { col: 18, row: 27 }
const SEARCH: Cell = { col: 2, row: 24 }
const DIETER: Cell = { col: 2, row: 29 }
// Where the feature spheres stand in Stock: one under the Loader, one beside it.
export const FEATURE_CELLS: Cell[] = [{ col: 7, row: 15 }, { col: 2, row: 15 }]

const LOOKS: Record<string, BuddyLook> = {
    Delegator: { eyes: 'pixel', mouth: 'flat', color: '#334155' },
    code: { eyes: 'visor', mouth: 'smile', color: '#4d34f7' },
    LARRY: { eyes: 'glasses', mouth: 'flat', color: '#0ea5e9' },
    LINUS: { eyes: 'brows', mouth: 'flat', color: '#10b981' },
    BRUCE: { eyes: 'shades', mouth: 'none', color: '#64748b' },
    search: { eyes: 'round', mouth: 'open', color: '#f472b6' },
    DIETER: { eyes: 'sparkle', mouth: 'cat', color: '#f59e0b' },
}

const CODE_COPIES = COPY_CELLS.code
const LINUS_COPIES = COPY_CELLS.LINUS
const SEARCH_COPY = COPY_CELLS.search[0]

// Features and their spheres: one share per task of the feature, the count known from the cut.
export type Feature = { issue: number; title: string; tasks: number[]; at: Cell }
export const FEATURES: Feature[] = [
    { issue: 320, title: 'Factory world', tasks: [330, 331, 332, 333, 334, 335, 336], at: FEATURE_CELLS[0] },
    { issue: 321, title: 'Polish', tasks: [337, 338, 339, 340, 341], at: FEATURE_CELLS[1] },
]

type JobSpec = { issue: number; title: string; start: number; build: number; review: number; checks: number; fix?: number; defect?: boolean }

// A wave of seven: six builds at once on `code`, the seventh on LARRY. #333 is sent back once by its
// review and comes round again; #338 is a defect and goes to the reject bin. Three tasks arrive while
// sending is held and go when the hold ends. #340 and #341 are cut and not started: their share of
// the feature stays empty.
const SPEC: JobSpec[] = [
    { issue: 330, title: 'Fab floor', start: 0, build: 13_000, review: 4_500, checks: 5_000 },
    { issue: 331, title: 'Ledger read route', start: 400, build: 16_500, review: 5_000, checks: 5_500 },
    { issue: 332, title: 'Heartbeat endpoint', start: 800, build: 11_000, review: 4_000, checks: 5_000 },
    { issue: 333, title: 'Hold barrier', start: 1_200, build: 14_000, review: 4_500, checks: 5_000, fix: 6_000 },
    { issue: 334, title: 'Glass copies', start: 1_600, build: 15_000, review: 4_500, checks: 5_000 },
    { issue: 335, title: 'Gauges', start: 2_000, build: 22_000, review: 5_000, checks: 5_500 },
    { issue: 336, title: 'Belts', start: 2_400, build: 17_000, review: 5_000, checks: 5_000 },
    { issue: 337, title: 'Scanner gate', start: 47_000, build: 9_000, review: 3_500, checks: 4_000 },
    { issue: 338, title: 'Reject bin', start: 48_000, build: 10_000, review: 3_500, checks: 4_000, defect: true },
    { issue: 339, title: 'Phone width', start: 49_000, build: 8_500, review: 3_500, checks: 4_000 },
]
const QUEUE_MS = 2_500
const VERDICT_MS = 1_300 // the last stretch of a review, when the scanner shows its verdict

type LegKind = 'queued' | 'build' | 'review' | 'fixing' | 'checks' | 'complete' | 'rejecting'
type Leg = { kind: LegKind; from: number; to: number; verdict?: 'pass' | 'fail'; level: [number, number] }
type Job = JobSpec & { legs: Leg[]; end: number; outcome: 'merged' | 'rejected'; builder: string; buildAt: Cell; buildCopy: boolean; reviewer: string; reviewAt: Cell; reviewCopy: boolean; feature: Feature }

function plan(): Job[] {
    const freeFrom = new Map<string, number>()
    const take = (keys: string[], t: number) => { const k = keys.find(key => (freeFrom.get(key) ?? 0) <= t); if (k) freeFrom.set(k, Infinity); return k }
    const buildKeys = [...CODE_COPIES.map((_, i) => `c${i}`), 'LARRY']
    const reviewKeys = ['LINUS', ...LINUS_COPIES.map((_, i) => `l${i}`), 'BRUCE']
    return SPEC.map((spec, n) => {
        const legs: Leg[] = []
        let t = spec.start + QUEUE_MS
        if (spec.start >= HOLD.from - 2_000 && t < HOLD.to) t = HOLD.to + (n % 3) * 700
        const leg = (kind: LegKind, ms: number, level: [number, number], verdict?: Leg['verdict']) => { legs.push({ kind, from: t, to: t + ms, level, verdict }); t += ms }
        legs.push({ kind: 'queued', from: spec.start, to: t, level: [0, 0] })
        const bk = take(buildKeys, t) ?? 'LARRY'
        leg('build', spec.build, [0, 0.4])
        freeFrom.set(bk, t)
        const rk = take(reviewKeys, t) ?? 'BRUCE'
        if (spec.fix) {
            leg('review', spec.review, [0.4, 0.5], 'fail')
            leg('fixing', spec.fix, [0.5, 0.6])
            leg('review', spec.review * 0.6, [0.6, 0.7], 'pass')
        } else {
            leg('review', spec.review, [0.4, 0.7], spec.defect ? 'fail' : 'pass')
        }
        freeFrom.set(rk, t)
        if (spec.defect) {
            leg('rejecting', TRANSIT_MS * 1.6 + SLIDE_MS, [0.7, 0.7])
        } else {
            leg('checks', spec.checks, [0.7, 0.95])
            leg('complete', SHAKE_MS + TRANSIT_MS + SLIDE_MS, [1, 1])
        }
        const feature = FEATURES.find(f => f.tasks.includes(spec.issue))!
        return {
            ...spec, legs, end: t, outcome: spec.defect ? 'rejected' : 'merged', feature,
            builder: bk === 'LARRY' ? 'LARRY' : 'code', buildAt: bk === 'LARRY' ? LARRY : CODE_COPIES[Number(bk.slice(1))], buildCopy: bk !== 'LARRY',
            reviewer: rk === 'BRUCE' ? 'BRUCE' : 'LINUS', reviewAt: rk === 'BRUCE' ? BRUCE : rk === 'LINUS' ? LINUS : LINUS_COPIES[Number(rk.slice(1))], reviewCopy: rk.startsWith('l'),
        }
    })
}
export const JOBS = plan()

// A task sphere rides the belts on the floor, from tile to tile: `path` is the tile ids it passes,
// `travel` how far along it is. A queued sphere waits on the loader's belt at `queue`.
export type Band = 'build' | 'review' | 'checks' | 'merge'
export type PodView = {
    id: string; issue: number; title: string
    path: string[]; travel: number; queue: number
    level: number // 0..1, how full the task's sphere is
    band: Band // the stage colouring the sphere now
    state: 'queued' | 'held' | 'working' | 'fixing' | 'checks' | 'complete' | 'rejected'
    verdict?: 'pass' | 'fail' // set while the scanner shows it, at the end of a review
    scan: number // 0..1 through a review, for the scanner's sweep
}
// Status colours, shared by the lines and the spheres.
export const STATUS_COLOR = { queued: '#8ea2ff', held: '#ef4444', build: '#f5a524', review: '#2dd4a3', fixing: '#fb923c', checks: '#6ea8ff', complete: '#ffe08a', rejected: '#f87171' } as const
export type SlotView = { issue: number; state: 'empty' | 'merged' | 'rejected'; arriving: number } // arriving: 0..1 while sliding in
export type CabinetView = Feature & { slots: SlotView[] }

export type FactoryFrame = {
    containers: Container[]
    tiles: Tile[]
    links: TileLink[]
    toasts: TileToast[]
    pods: PodView[]
    cabinets: CabinetView[]
    rejects: number // tasks in the reject bin
    held: boolean
    holdLeftMs: number
    counts: { queued: number; building: number; review: number; checks: number; merged: number; runs: number }
}

const clamp = (x: number) => Math.max(0, Math.min(1, x))
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

function coworker(id: string, who: string, position: Cell, room: string, state: 'working' | 'idle' | 'waiting_human', opts: { copy?: boolean; behind?: boolean } = {}): Tile {
    return {
        id, position, span: 2, containerId: room, selectable: false, draggable: false, justPlaced: !!opts.copy,
        style: {
            ...(state === 'working' && who !== 'Delegator'
                ? { ...agentTileStyle('idle', who), glow: `color-mix(in srgb, ${LOOKS[who].color} 60%, transparent)`, buddy: { ...LOOKS[who], mood: 'working' as const, ownColor: true } }
                : { ...agentTileStyle(state, who), buddy: { ...LOOKS[who] } }),
            ...(opts.copy ? { opacity: 0.55 } : opts.behind ? { opacity: 0.5 } : {}),
        },
        ariaLabel: opts.copy ? `${who}, a copy` : who,
    }
}

export function factoryScene(t: number, now: number): FactoryFrame {
    const held = t >= HOLD.from && t < HOLD.to
    const tiles: Tile[] = []
    const links: TileLink[] = []
    const toasts: TileToast[] = []
    const pods: PodView[] = []
    const busy = new Set<string>()
    const counts = { queued: 0, building: 0, review: 0, checks: 0, merged: 0, runs: 0 }
    const merged: TileResultItem[] = []
    const slotState = new Map<number, SlotView>()
    const toast = (from: number, tileId: string, author: string, message: string) => {
        if (t >= from && t < from + 3_000) toasts.push({ id: `${tileId}@${from}`, tileId, author, message })
    }

    let rejects = 0
    for (const job of JOBS) {
        if (t < job.start) continue
        const buildHolder = job.buildCopy ? `code-copy-${job.issue}` : 'LARRY'
        const reviewHolder = job.reviewCopy ? `linus-copy-${job.issue}` : job.reviewer
        const via = (...xs: string[]) => xs.filter((x, i) => i === 0 || x !== xs[i - 1])
        if (t >= job.end) {
            slotState.set(job.issue, { issue: job.issue, state: job.outcome, arriving: 1 })
            if (job.outcome === 'merged') { counts.merged++; merged.push({ label: `#${job.issue} ${job.title}`, count: 1, at: Math.round(now - t) + job.end }) }
            else rejects++
            continue
        }
        const legIndex = job.legs.findIndex(l => t >= l.from && t < l.to)
        const leg = job.legs[legIndex]
        if (!leg) continue
        const k = clamp((t - leg.from) / (leg.to - leg.from))
        const level = leg.level[0] + (leg.level[1] - leg.level[0]) * k
        const prev = job.legs[legIndex - 1]
        const ride = (t - leg.from) / (TRANSIT_MS * 1.6)
        const pod = (path: string[], travel: number, band: Band, state: PodView['state'], extra: Partial<PodView> = {}) =>
            pods.push({ id: `pod-${job.issue}`, issue: job.issue, title: job.title, path, travel: ease(clamp(travel)), queue: 0, level, band, state, scan: 0, ...extra })
        counts.runs += leg.kind === 'queued' ? 0 : 1

        if (leg.kind === 'queued') {
            counts.queued++
            pod(['Delegator', 'code'], 0, 'build', held ? 'held' : 'queued')
        } else if (leg.kind === 'build') {
            counts.building++
            busy.add(job.builder)
            pod(via('Delegator', 'code', buildHolder), ride, 'build', 'working')
            if (job.buildCopy) {
                tiles.push(coworker(buildHolder, 'code', job.buildAt, 'build', 'working', { copy: true }))
                links.push({ source: 'code', target: buildHolder, variant: 'trace', color: STATUS_COLOR.build })
            }
            toast(leg.to - 2_600, buildHolder, job.buildCopy ? 'code · copy' : 'LARRY', `#${job.issue}: pull request opened`)
        } else if (leg.kind === 'review') {
            counts.review++
            busy.add(job.reviewer)
            const from = prev?.kind === 'fixing' ? 'code' : buildHolder
            const verdict = leg.to - t < VERDICT_MS ? leg.verdict : undefined
            pod(via(from, 'code', 'LINUS', reviewHolder), ride, 'review', 'working', { verdict, scan: k })
            if (job.reviewCopy) {
                tiles.push(coworker(reviewHolder, 'LINUS', job.reviewAt, 'review', 'working', { copy: true }))
                links.push({ source: 'LINUS', target: reviewHolder, variant: 'trace', color: STATUS_COLOR.review })
            }
            const next = job.legs[legIndex + 1]?.kind
            toast(leg.to - VERDICT_MS, reviewHolder, job.reviewer, leg.verdict === 'pass' ? `#${job.issue}: passed` : next === 'fixing' ? `#${job.issue}: sent back for a fix` : `#${job.issue}: defect, rejected`)
        } else if (leg.kind === 'fixing') {
            counts.building++
            busy.add('code')
            pod(via(reviewHolder, 'LINUS', 'code'), ride, 'build', 'fixing')
        } else if (leg.kind === 'rejecting') {
            const arrive = TRANSIT_MS * 1.6
            pod(via(reviewHolder, 'LINUS', 'rejects'), (t - leg.from) / arrive, 'review', 'rejected')
            if (t - leg.from >= arrive) slotState.set(job.issue, { issue: job.issue, state: 'rejected', arriving: clamp((t - leg.from - arrive) / SLIDE_MS) })
        } else if (leg.kind === 'checks') {
            counts.checks++
            pod(via(reviewHolder, 'LINUS', 'Delegator'), ride, 'checks', 'checks')
        } else {
            // Complete: full, a gentle shake, the ride to its feature, and it pours in.
            const travel = (t - leg.from - SHAKE_MS) / TRANSIT_MS
            pod(via('Delegator', `cab-${job.feature.issue}`), travel, 'merge', 'complete')
            if (t >= leg.from + SHAKE_MS + TRANSIT_MS) slotState.set(job.issue, { issue: job.issue, state: 'merged', arriving: clamp((t - leg.from - SHAKE_MS - TRANSIT_MS) / SLIDE_MS) })
            toast(leg.from, 'Delegator', 'Loader', `#${job.issue} merged into dev`)
        }
    }

    let q = 0
    for (const p of pods) if (p.state === 'queued' || p.state === 'held') p.queue = q++

    const cabinets: CabinetView[] = FEATURES.map(f => ({ ...f, slots: f.tasks.map(issue => slotState.get(issue) ?? { issue, state: 'empty', arriving: 0 }) }))
    for (const c of cabinets) {
        const filled = c.slots.filter(x => x.state !== 'empty').length
        tiles.push({ id: `cab-${c.issue}`, position: c.at, span: 2, containerId: 'stock', selectable: false, draggable: false,
            style: { color: '#1b2140', sheen: true, depth: 2 }, ariaLabel: `Feature #${c.issue} ${c.title}: ${filled} of ${c.slots.length}` })
    }

    // The reject bin: defects end here, beside the scanners.
    tiles.push({ id: 'rejects', position: REJECT_BIN, span: 2, containerId: 'review', selectable: false, draggable: false,
        style: { color: '#2a1416', sheen: true, depth: 2 }, ariaLabel: `Reject bin: ${rejects}` })

    // The studio keeps a rhythm of its own.
    const researching = t % 30_000 < 16_000
    if (researching) {
        tiles.push(coworker('search-copy', 'search', SEARCH_COPY, 'studio', 'working', { copy: true }))
        links.push({ source: 'search', target: 'search-copy', variant: 'trace', color: '#f472b6' })
    }
    const state = (who: string) => (busy.has(who) ? 'working' : 'idle') as 'working' | 'idle'
    tiles.push(coworker('code', 'code', CODE, 'build', state('code')))
    tiles.push(coworker('LARRY', 'LARRY', LARRY, 'build', state('LARRY'), { behind: !busy.has('LARRY') }))
    tiles.push(coworker('LINUS', 'LINUS', LINUS, 'review', state('LINUS')))
    tiles.push(coworker('BRUCE', 'BRUCE', BRUCE, 'review', state('BRUCE'), { behind: !busy.has('BRUCE') }))
    tiles.push(coworker('search', 'search', SEARCH, 'studio', researching ? 'working' : 'idle'))
    tiles.push(coworker('DIETER', 'DIETER', DIETER, 'studio', t % 26_000 > 12_000 ? 'working' : 'idle'))

    const loader = coworker('Delegator', 'Delegator', LOADER, 'dispatch', held ? 'waiting_human' : counts.queued + counts.checks > 0 ? 'working' : 'idle')
    loader.style = { ...loader.style, label: 'Loader', shape: 'capsule' as const, ...(held ? { badge: 'lock' as const } : {}), ...(merged.length && !held ? { results: { count: merged.length, items: merged.slice(-6).reverse() } } : {}) }
    tiles.push(loader)
    if (held) toast(HOLD.from + 300, 'Delegator', 'Loader', 'Sending held: sign-in renewal. Running builds finish.')

    // The belts join the loader, `code`, LINUS, the reject bin and the feature spheres.
    const lines: [string, string][] = [['Delegator', 'code'], ['code', 'LINUS'], ['LINUS', 'Delegator'], ['code', 'LARRY'], ['LINUS', 'BRUCE'], ['LINUS', 'rejects'], ...FEATURES.map(f => ['Delegator', `cab-${f.issue}`] as [string, string])]
    // A line glows in the colour of what runs on it: build amber, review green, checks blue, a merge
    // gold, a held line red; a quiet line keeps the board's own blue-white.
    const QUIET = '#8ea2ff'
    const lineColor = new Map<string, string>()
    for (const p of pods) {
        const color = p.state === 'held' ? STATUS_COLOR.held : p.state === 'checks' ? STATUS_COLOR.checks : p.state === 'complete' ? STATUS_COLOR.complete : p.state === 'fixing' ? STATUS_COLOR.fixing : p.state === 'rejected' ? STATUS_COLOR.rejected : p.state === 'working' ? STATUS_COLOR[p.band === 'review' ? 'review' : 'build'] : null
        if (!color) continue
        for (let i = 1; i < p.path.length; i++) { lineColor.set(`${p.path[i - 1]}>${p.path[i]}`, color); lineColor.set(`${p.path[i]}>${p.path[i - 1]}`, color) }
    }
    for (const [a, b] of lines) {
        links.push({ source: a, target: b, variant: 'belt', color: held ? STATUS_COLOR.held : lineColor.get(`${a}>${b}`) ?? QUIET, chevrons: true })
    }

    return { containers: BOXES, tiles, links, toasts, pods, cabinets, rejects, held, holdLeftMs: held ? HOLD.to - t : 0, counts }
}
