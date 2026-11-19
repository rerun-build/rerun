import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { routeBoard, routeHitsBox, routesCross, tileAxisBox } from '@/lib/board/iso-route'
import type { AxisRoute } from '@/lib/board/iso-route'
import { GRID_SIZE, TILE_H, TILE_W, isoPosition } from '@moldwright/ui/iso-grid/iso'

import { FOCUS_BOX_ID, FOCUS_TILE_IDS, LAST_TOUR_PHASE, TOUR_AGENTS, TOUR_BOXES, TOUR_CAMERA_SETTLE, TOUR_CONNECTORS, TOUR_HANDOFFS, TOUR_MODEL_PHASE, TOUR_STAGE_BOUNDS, boardForPhase, frameTourPhase, frameTourStage, isTourFocusPhase, linkId } from '@moldwright/ui/tour/board'
import { TOUR_TEAMMATES } from '@moldwright/ui/tour/team'

const full = boardForPhase(LAST_TOUR_PHASE)
const tileById = new Map(full.tiles.map(tile => [tile.id, tile]))
const agentIds = new Set(TOUR_AGENTS.map(agent => agent.id))
const connectorIds = new Set(TOUR_CONNECTORS.map(connector => connector.id))

const drawn = routeBoard(full.tiles, full.links)
const wires = full.links.map(link => {
    if (!tileById.has(link.source) || !tileById.has(link.target)) throw new Error(`wire to a missing tile: ${linkId(link.source, link.target)}`)
    return { id: linkId(link.source, link.target), sourceId: link.source, targetId: link.target, points: drawn.get(`${link.source}->${link.target}`) ?? [] }
})
const handoffRoute = (handoff: (typeof TOUR_HANDOFFS)[number]) =>
    routeBoard(full.tiles, [...full.links, { source: handoff.source, target: handoff.target, variant: 'beam' }]).get(`${handoff.source}->${handoff.target}`) ?? []

const asRoute = (wire: (typeof wires)[number]): AxisRoute => ({ points: wire.points, sourceId: wire.sourceId })

const footprint = (col: number, row: number, span: number) => ({ cols: [col, col + span - 1] as const, rows: [row, row + span - 1] as const })
const overlaps = (a: ReturnType<typeof footprint>, b: ReturnType<typeof footprint>) =>
    a.cols[0] <= b.cols[1] && b.cols[0] <= a.cols[1] && a.rows[0] <= b.rows[1] && b.rows[0] <= a.rows[1]

describe('tour board geometry', () => {
    it('never overlaps two tiles', () => {
        const collisions: string[] = []
        const boxes = full.tiles.map(tile => ({ id: tile.id, box: footprint(tile.position.col, tile.position.row, tile.span ?? 2) }))
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                if (overlaps(boxes[i].box, boxes[j].box)) collisions.push(`${boxes[i].id} x ${boxes[j].id}`)
            }
        }
        expect(collisions).toEqual([])
    })

    it('keeps every agent inside its own Box', () => {
        const boxById = new Map(TOUR_BOXES.map(box => [box.id, box]))
        for (const agent of TOUR_AGENTS) {
            const box = boxById.get(agent.boxId)
            expect(box, `unknown Box ${agent.boxId}`).toBeDefined()
            if (!box) continue
            const { cols, rows } = footprint(agent.col, agent.row, 2)
            expect([agent.id, cols[0] >= box.col_start, cols[1] <= box.col_end, rows[0] >= box.row_start, rows[1] <= box.row_end]).toEqual([agent.id, true, true, true, true])
        }
    })

    it('keeps every connector outside every Box', () => {
        const inside = TOUR_CONNECTORS.filter(connector =>
            TOUR_BOXES.some(box => connector.col >= box.col_start && connector.col <= box.col_end && connector.row >= box.row_start && connector.row <= box.row_end),
        )
        expect(inside.map(connector => connector.id)).toEqual([])
    })

    it('leaves a free cell between a connector and its agent', () => {
        const agentById = new Map(TOUR_AGENTS.map(agent => [agent.id, agent]))
        const tooClose: string[] = []
        for (const connector of TOUR_CONNECTORS) {
            for (const agentId of [connector.agentId, ...(connector.additionalAgentIds ?? [])]) {
                const agent = agentById.get(agentId)
                expect(agent, `unknown agent ${agentId}`).toBeDefined()
                if (!agent) continue
                const { cols, rows } = footprint(agent.col, agent.row, 2)
                const dc = Math.max(cols[0] - connector.col, connector.col - cols[1], 0)
                const dr = Math.max(rows[0] - connector.row, connector.row - rows[1], 0)
                if (Math.max(dc, dr) < 2) tooClose.push(`${connector.id}->${agentId} (${dc},${dr})`)
            }
        }
        expect(tooClose).toEqual([])
    })

    it('never crosses two wires', () => {
        const crossings: string[] = []
        for (let i = 0; i < wires.length; i++) {
            for (let j = i + 1; j < wires.length; j++) {
                if (routesCross(asRoute(wires[i]), asRoute(wires[j]))) crossings.push(`${wires[i].id} x ${wires[j].id}`)
            }
        }
        expect(crossings).toEqual([])
    })

    it('never runs a wire under a third tile', () => {
        const swallowed: string[] = []
        for (const wire of wires) {
            for (const tile of full.tiles) {
                if (tile.id === wire.sourceId || tile.id === wire.targetId) continue
                if (routeHitsBox(wire.points, tileAxisBox(tile))) swallowed.push(`${wire.id} under ${tile.id}`)
            }
        }
        expect(swallowed).toEqual([])
    })

    it('wires agent to connector, hand-offs agent to agent, and the model marks with a beam', () => {
        const phaseOf = new Map(TOUR_CONNECTORS.map(connector => [connector.id, connector.phase]))
        for (const link of full.links) {
            const expected = phaseOf.get(link.target) === TOUR_MODEL_PHASE ? 'beam' : 'cable'
            expect([link.variant, agentIds.has(link.source), connectorIds.has(link.target)]).toEqual([expected, true, true])
        }
        for (const handoff of TOUR_HANDOFFS) {
            expect([agentIds.has(handoff.source), agentIds.has(handoff.target), handoff.source === handoff.target]).toEqual([true, true, false])
        }
    })

    it.skip('draws every hand-off as one straight run', () => {
        const elbowed: string[] = []
        for (const handoff of TOUR_HANDOFFS) {
            if (!tileById.has(handoff.source) || !tileById.has(handoff.target)) throw new Error(`hand-off to a missing tile: ${handoff.id}`)
            const points = handoffRoute(handoff)
            if (points.length !== 2) elbowed.push(`${handoff.id} (${points.length} points)`)
        }
        expect(elbowed).toEqual([])
    })

    it('never runs a hand-off under an agent', () => {
        const swallowed: string[] = []
        for (const handoff of TOUR_HANDOFFS) {
            const points = handoffRoute(handoff)
            for (const agent of TOUR_AGENTS) {
                if (agent.id === handoff.source || agent.id === handoff.target) continue
                if (routeHitsBox(points, tileAxisBox(tileById.get(agent.id)!))) swallowed.push(`${handoff.id} under ${agent.id}`)
            }
        }
        expect(swallowed).toEqual([])
    })

    it('lays the three Boxes out as a triangle, mirrored about the vertical', () => {
        const [marketing, sales, ops] = TOUR_BOXES
        const screenRow = (box: (typeof TOUR_BOXES)[number]) => box.col_start + box.row_start
        expect(screenRow(sales)).toBe(screenRow(ops))
        expect(screenRow(marketing)).toBeLessThan(screenRow(sales))
        expect([sales.col_start, sales.row_start]).toEqual([ops.row_start, ops.col_start])
        expect(marketing.col_start).toBe(marketing.row_start)
    })

    it.skip('mirrors every tile about the vertical axis of the screen', () => {
        const cells = new Set(full.tiles.map(tile => `${tile.position.col},${tile.position.row}`))
        const unpaired = [...cells].filter(cell => {
            const [col, row] = cell.split(',')
            return !cells.has(`${row},${col}`)
        })
        expect(unpaired).toEqual([])
    })

    const landingPublic = path.resolve(import.meta.dirname, '../../../landing/public')
    it.each([['app', '../../public'], ...(existsSync(landingPublic) ? [['landing', '../../../landing/public']] : [])])('serves every mark and every portrait from a file committed under the %s', (_where, dir) => {
        const publicDir = path.resolve(import.meta.dirname, dir)
        const missing = [...TOUR_CONNECTORS.map(connector => connector.icon), ...TOUR_TEAMMATES.map(mate => mate.photo)].filter(
            asset => !existsSync(path.join(publicDir, asset.split('?')[0])),
        )
        expect(missing).toEqual([])
    })
})

const modelMarks = TOUR_CONNECTORS.filter(connector => connector.phase === TOUR_MODEL_PHASE)

describe('boardForPhase', () => {
    it('holds every piece of every phase below it', () => {
        let previous: string[] = []
        for (let phase = 0; phase <= LAST_TOUR_PHASE; phase++) {
            const ids = boardForPhase(phase).tiles.map(tile => tile.id)
            expect(previous.every(id => ids.includes(id)), `phase ${phase} dropped a tile`).toBe(true)
            previous = ids
        }
    })

    it('opens on the three Boxes alone, then the agents, then the models, then the tools', () => {
        expect(boardForPhase(0).tiles).toEqual([])
        expect(boardForPhase(0).containers.map(container => container.label)).toEqual(['Marketing', 'Sales', 'Ops'])

        const agents = boardForPhase(1)
        expect(agents.tiles).toHaveLength(TOUR_AGENTS.length)
        expect(agents.tiles.every(tile => tile.span === 2)).toBe(true)
        expect(agents.links).toEqual([])

        const models = boardForPhase(2)
        expect(models.tiles.filter(tile => tile.span === 2)).toHaveLength(TOUR_AGENTS.length)
        expect(models.tiles.filter(tile => tile.span === 1)).toHaveLength(modelMarks.length)

        const tools = boardForPhase(3)
        expect(tools.tiles).toHaveLength(TOUR_AGENTS.length + TOUR_CONNECTORS.length)
    })

    it('lights the model marks only when the shot asks for it', () => {
        expect(boardForPhase(LAST_TOUR_PHASE).tiles.some(tile => tile.highlighted)).toBe(false)

        const lit = boardForPhase(LAST_TOUR_PHASE, { animatedPhase: null, lit: true })
        expect(
            lit.tiles
                .filter(tile => tile.highlighted)
                .map(tile => tile.id)
                .sort(),
        ).toEqual(modelMarks.map(connector => connector.id).sort())
    })

    it('animates the phase being entered and nothing else', () => {
        const entering = boardForPhase(3, { animatedPhase: 3 })
        const landed = entering.tiles.filter(tile => tile.justPlaced).map(tile => tile.id)
        expect(landed.sort()).toEqual(
            TOUR_CONNECTORS.filter(connector => connector.phase === 3)
                .map(connector => connector.id)
                .sort(),
        )
        expect(entering.containers.every(container => !container.justPlaced)).toBe(true)
        expect(boardForPhase(3).tiles.every(tile => !tile.justPlaced)).toBe(true)
    })

    it('lands the seven agents, and only them, on the agents slide', () => {
        const entering = boardForPhase(1, { animatedPhase: 1 })
        expect(entering.tiles.map(tile => tile.id)).toEqual(TOUR_AGENTS.map(agent => agent.id))
        expect(entering.tiles.every(tile => tile.justPlaced)).toBe(true)
        expect(entering.containers.every(container => !container.justPlaced)).toBe(true)

        const delays = entering.tiles.map(tile => tile.dropDelay ?? 0)
        expect(delays[0]).toBeGreaterThan(0)
        for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1])
    })

    it('plugs a wire in after its connector has landed', () => {
        const entering = boardForPhase(2, { animatedPhase: 2 })
        const dropById = new Map(entering.tiles.map(tile => [tile.id, tile.dropDelay ?? 0]))
        for (const link of entering.links) expect(link.appearDelay ?? 0).toBeGreaterThan(dropById.get(link.target) ?? 0)
    })
})

describe('walking back', () => {
    const leaving = (phase: number, livePhase: number) => boardForPhase(phase, { animatedPhase: null, lit: true, livePhase })

    it('keeps the pieces of the phase being left on the board, in retreat', () => {
        const back = leaving(3, 2)
        expect(back.tiles.map(tile => tile.id).sort()).toEqual(boardForPhase(3).tiles.map(tile => tile.id).sort())

        const faded = back.tiles.filter(tile => tile.dimmed).map(tile => tile.id)
        expect(faded.sort()).toEqual(
            TOUR_CONNECTORS.filter(connector => connector.phase === 3)
                .map(connector => connector.id)
                .sort(),
        )
    })

    it('takes the agents off the first slide and leaves the three Boxes standing', () => {
        const back = leaving(1, 0)
        expect(back.tiles.filter(tile => tile.dimmed).map(tile => tile.id).sort()).toEqual(TOUR_AGENTS.map(agent => agent.id).sort())
        for (const container of back.containers) expect(container.dimmed).toBeFalsy()
    })

    it('keeps the model marks lit while they fade off', () => {
        const back = leaving(2, 1)
        for (const mark of modelMarks) {
            const tile = back.tiles.find(t => t.id === mark.id)
            expect(tile?.dimmed, `${mark.id} is not on its way out`).toBe(true)
            expect(tile?.highlighted, `${mark.id} went dark before it left`).toBe(true)
        }
    })

    it('never lands a piece that is on its way out', () => {
        const back = boardForPhase(3, { animatedPhase: 3, livePhase: 2 })
        for (const tile of back.tiles) expect(tile.justPlaced, `${tile.id} lands on its way out`).toBeFalsy()
    })

    it('holds a tool the close-up was fading in retreat once the camera pulls back', () => {
        const off = boardForPhase(3, { animatedPhase: null, focused: false, livePhase: 2 })
        for (const connector of TOUR_CONNECTORS.filter(c => c.phase === 3)) {
            expect(off.tiles.find(tile => tile.id === connector.id)?.dimmed, `${connector.id} lights up on its way out`).toBe(true)
        }
    })

    it('brings everything back at full strength once the slide is reached', () => {
        const settled = boardForPhase(2, { animatedPhase: null, lit: true, livePhase: 2 })
        for (const tile of settled.tiles) expect(tile.dimmed).toBeFalsy()
    })
})

describe('frameTourStage', () => {
    it('centres the whole scene, the last phase included, in the frame it is given', () => {
        const { zoom, pan } = frameTourStage({ width: 672, height: 520 })
        expect(zoom).toBeGreaterThan(0.6)
        expect(zoom).toBeLessThanOrEqual(1.6)
        expect(Math.abs(pan.x)).toBeLessThan(400)
        expect(Math.abs(pan.y)).toBeLessThan(400)
    })

    it('holds the corners the Box labels hang off inside the frame', () => {
        const cornerX = (col: number, row: number) => isoPosition(col, row).left + TILE_W / 2 - isoPosition(GRID_SIZE / 2, GRID_SIZE / 2).left
        const [, sales, ops] = TOUR_BOXES
        expect(TOUR_STAGE_BOUNDS.left).toBe(cornerX(sales.col_start, sales.row_end + 1))
        expect(TOUR_STAGE_BOUNDS.right).toBe(cornerX(ops.col_end + 1, ops.row_start))

        const frame = { width: 672, height: 396 }
        const { zoom } = frameTourStage(frame)
        expect((TOUR_STAGE_BOUNDS.right - TOUR_STAGE_BOUNDS.left) * zoom).toBeLessThanOrEqual(frame.width)
    })

    it('fits the whole scene in every frame, and holds one zoom across the dialog', () => {
        const width = TOUR_STAGE_BOUNDS.right - TOUR_STAGE_BOUNDS.left
        const height = TOUR_STAGE_BOUNDS.bottom - TOUR_STAGE_BOUNDS.top
        const cropped = (frame: { width: number; height: number }) => {
            const { zoom } = frameTourStage(frame)
            return [width * zoom > frame.width, height * zoom > frame.height]
        }
        for (const frame of [
            { width: 672, height: 520 },
            { width: 672, height: 470 },
            { width: 672, height: 396 },
            { width: 380, height: 358 },
        ]) {
            expect(cropped(frame), `cropped at ${frame.width}x${frame.height}`).toEqual([false, false])
        }

        expect(frameTourStage({ width: 672, height: 470 }).zoom).toBeCloseTo(frameTourStage({ width: 672, height: 520 }).zoom, 5)
    })
})

describe('the connectors close-up', () => {
    const FOCUS_PHASE = 3
    const focus = boardForPhase(FOCUS_PHASE, { animatedPhase: FOCUS_PHASE, focused: true })

    it('leaves Marketing standing and puts the whole rest of the plateau in retreat', () => {
        for (const container of focus.containers) {
            expect(!!container.dimmed, `${container.id} is on the wrong side of the close-up`).toBe(container.id !== FOCUS_BOX_ID)
        }
        for (const tile of focus.tiles) {
            expect(!!tile.dimmed, `${tile.id} is on the wrong side of the close-up`).toBe(!FOCUS_TILE_IDS.has(tile.id))
        }
        const marketingAgentIds = TOUR_AGENTS.filter(agent => agent.boxId === FOCUS_BOX_ID).map(agent => agent.id)
        const owned = [
            ...marketingAgentIds,
            ...TOUR_CONNECTORS.filter(connector => marketingAgentIds.includes(connector.agentId)).map(c => c.id),
        ]
        expect([...FOCUS_TILE_IDS].sort()).toEqual(owned.sort())
    })

    it('never lands a tile that is in retreat', () => {
        for (const tile of focus.tiles) expect(tile.dimmed && tile.justPlaced, `${tile.id} falls out of a frame it is not in`).toBeFalsy()
        const landing = focus.tiles.filter(tile => tile.justPlaced)
        expect(landing.map(tile => tile.id).sort()).toEqual(
            TOUR_CONNECTORS.filter(connector => connector.phase === FOCUS_PHASE && FOCUS_TILE_IDS.has(connector.id))
                .map(connector => connector.id)
                .sort()
        )
        expect(landing.length).toBeGreaterThan(0)
        for (const tile of landing) expect(tile.dropDelay).toBeGreaterThanOrEqual(TOUR_CAMERA_SETTLE)
    })

    it('brings the plateau back whole on the team slide', () => {
        const team = boardForPhase(LAST_TOUR_PHASE, { animatedPhase: null })
        for (const container of team.containers) expect(container.dimmed).toBeFalsy()
        for (const tile of team.tiles) expect(tile.dimmed).toBeFalsy()
    })

    it('closes in again when the slide is walked back into', () => {
        const walkedBack = boardForPhase(LAST_TOUR_PHASE, { animatedPhase: null, focused: true })
        expect(walkedBack.tiles.filter(tile => tile.dimmed).length).toBe(walkedBack.tiles.length - FOCUS_TILE_IDS.size)
        expect(walkedBack.tiles.every(tile => !tile.justPlaced)).toBe(true)
    })
})

describe('frameTourPhase', () => {
    const FRAME = { width: 672, height: 396 }
    const CENTER = isoPosition(GRID_SIZE / 2, GRID_SIZE / 2)

    type Camera = ReturnType<typeof frameTourStage>

    const worldBox = (col: number, row: number, span: number) => {
        const { left, top } = isoPosition(col, row)
        const x = left - ((span - 1) * TILE_W) / 2 - CENTER.left
        const y = top - CENTER.top
        return { left: x, right: x + span * TILE_W, top: y, bottom: y + span * TILE_H }
    }

    const onScreen = (camera: Camera, x: number, y: number) => ({ x: (x + camera.pan.x) * camera.zoom, y: (y + camera.pan.y) * camera.zoom })
    const holdsPoint = (camera: Camera, x: number, y: number) => {
        const p = onScreen(camera, x, y)
        return Math.abs(p.x) <= FRAME.width / 2 && Math.abs(p.y) <= FRAME.height / 2
    }
    const holds = (camera: Camera, box: ReturnType<typeof worldBox>) => holdsPoint(camera, box.left, box.top) && holdsPoint(camera, box.right, box.bottom)

    const corner = (col: number, row: number) => {
        const { left, top } = isoPosition(col, row)
        return { x: left + TILE_W / 2 - CENTER.left, y: top - CENTER.top }
    }

    const FOCUS_PHASE = 3
    const marketing = TOUR_BOXES[0]
    const marketingAgents = TOUR_AGENTS.filter(agent => agent.boxId === marketing.id)
    const marketingConnectors = TOUR_CONNECTORS.filter(connector => marketingAgents.some(agent => agent.id === connector.agentId))

    it('plays the connectors slide close and every other slide on one and the same wide shot', () => {
        expect([0, 1, 2, 3, 4].map(isTourFocusPhase)).toEqual([false, false, false, true, false])

        const wide = frameTourStage(FRAME)
        for (const phase of [0, 1, 2, LAST_TOUR_PHASE]) expect(frameTourPhase(phase, FRAME)).toEqual(wide)
        expect(frameTourPhase(FOCUS_PHASE, FRAME).zoom).toBeGreaterThan(wide.zoom)
    })

    it('holds Marketing, its agents and every connector it is about to draw', () => {
        const camera = frameTourPhase(FOCUS_PHASE, FRAME)
        for (const [col, row] of [
            [marketing.col_start, marketing.row_start],
            [marketing.col_end + 1, marketing.row_start],
            [marketing.col_end + 1, marketing.row_end + 1],
            [marketing.col_start, marketing.row_end + 1],
        ]) {
            const { x, y } = corner(col, row)
            expect(holdsPoint(camera, x, y), 'the close shot crops the Box').toBe(true)
        }
        for (const agent of marketingAgents) expect(holds(camera, worldBox(agent.col, agent.row, 2)), `the close shot crops ${agent.id}`).toBe(true)
        for (const connector of marketingConnectors) {
            expect(holds(camera, worldBox(connector.col, connector.row, 1)), `the close shot crops ${connector.id}`).toBe(true)
        }
    })

    it('crops Sales and Ops in the close shot and has them whole again on the last slide', () => {
        const [, sales, ops] = TOUR_BOXES
        const arms = [corner(sales.col_start, sales.row_end + 1), corner(ops.col_end + 1, ops.row_start)]
        const outsiders = TOUR_AGENTS.filter(agent => agent.boxId !== marketing.id)
        const camera = frameTourPhase(FOCUS_PHASE, FRAME)
        for (const { x, y } of arms) expect(holdsPoint(camera, x, y), 'the close shot still shows both arms').toBe(false)
        for (const agent of outsiders) expect(holds(camera, worldBox(agent.col, agent.row, 2)), `the close shot holds ${agent.id} whole`).toBe(false)

        const wide = frameTourPhase(LAST_TOUR_PHASE, FRAME)
        for (const { x, y } of arms) expect(holdsPoint(wide, x, y)).toBe(true)
        for (const agent of outsiders) expect(holds(wide, worldBox(agent.col, agent.row, 2)), `the wide shot lost ${agent.id}`).toBe(true)
    })

    it('hangs the close shot on the marks crowning Marketing', () => {
        const camera = frameTourPhase(FOCUS_PHASE, FRAME)
        const fromTop = (y: number) => onScreen(camera, 0, y).y + FRAME.height / 2
        const crown = Math.min(...marketingConnectors.map(connector => worldBox(connector.col, connector.row, 1).top))
        const southTip = corner(marketing.col_end + 1, marketing.row_end + 1).y

        expect(fromTop(crown)).toBeLessThan(FRAME.height / 3)
        expect(fromTop(southTip), 'the close shot is sitting on the floor again').toBeLessThan(FRAME.height * 0.9)
    })

    it.skip('centres the close shot on Marketing', () => {
        const west = corner(marketing.col_start, marketing.row_end + 1).x
        const east = corner(marketing.col_end + 1, marketing.row_start).x
        expect(frameTourPhase(FOCUS_PHASE, FRAME).pan.x).toBeCloseTo(-(west + east) / 2, 5)
    })
})
