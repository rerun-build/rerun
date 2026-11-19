import { AGENT_SPAN } from '@moldwright/ui/iso-grid'
import { describe, expect, it } from 'vitest'

import { CABLE_DRAW_MS, routeBoard, routeHitsBox, routesCross, tileAxisBox } from '@/lib/board/iso-route'
import type { AxisRoute } from '@/lib/board/iso-route'

import { buildAuthStage, stageLinkId } from './auth-stage-board'

const stage = buildAuthStage()

const tileById = new Map(stage.tiles.map(tile => [tile.id, tile]))
const containerOf = (tileId: string) => tileById.get(tileId)?.containerId

const cableLinks = stage.links.filter(link => link.variant === 'cable')
const drawn = routeBoard(stage.tiles, cableLinks)
const cableRoutes = cableLinks.map(link => {
    if (!tileById.has(link.source) || !tileById.has(link.target)) throw new Error(`lien vers une tuile absente: ${stageLinkId(link.source, link.target)}`)
    return {
        id: stageLinkId(link.source, link.target),
        sourceId: link.source,
        targetId: link.target,
        points: drawn.get(`${link.source}->${link.target}`) ?? [],
    }
})

const asRoute = (cable: (typeof cableRoutes)[number]): AxisRoute => ({ points: cable.points, sourceId: cable.sourceId })

describe('buildAuthStage', () => {
    it('ne fait se croiser aucun câble', () => {
        const crossings: string[] = []
        for (let i = 0; i < cableRoutes.length; i++) {
            for (let j = i + 1; j < cableRoutes.length; j++) {
                if (routesCross(asRoute(cableRoutes[i]), asRoute(cableRoutes[j]))) crossings.push(`${cableRoutes[i].id} x ${cableRoutes[j].id}`)
            }
        }
        expect(crossings).toEqual([])
    })

    it('ne fait passer aucun câble sous une tuile tierce', () => {
        const swallowed: string[] = []
        for (const cable of cableRoutes) {
            for (const tile of stage.tiles) {
                if (tile.id === cable.sourceId || tile.id === cable.targetId) continue
                if (routeHitsBox(cable.points, tileAxisBox(tile))) swallowed.push(`${cable.id} sous ${tile.id}`)
            }
        }
        expect(swallowed).toEqual([])
    })

    it('laisse une cellule vide entre chaque connecteur et sa box', () => {
        const containerById = new Map(stage.containers.map(container => [container.id, container]))

        for (const cable of cableRoutes) {
            const agent = tileById.get(cable.sourceId)
            const connector = tileById.get(cable.targetId)
            const container = containerById.get(agent?.containerId ?? '')
            if (!agent || !connector || !container) throw new Error(`câble orphelin: ${cable.id}`)

            const dc = Math.max(container.col_start - connector.position.col, 0, connector.position.col - container.col_end)
            const dr = Math.max(container.row_start - connector.position.row, 0, connector.position.row - container.row_end)
            expect(Math.max(dc, dr), `${connector.id} contre ${container.id}`).toBe(2)
        }
    })

    it('ne superpose aucune tuile', () => {
        for (let i = 0; i < stage.tiles.length; i++) {
            for (let j = i + 1; j < stage.tiles.length; j++) {
                const a = stage.tiles[i]
                const b = stage.tiles[j]
                const spanA = a.span ?? AGENT_SPAN
                const spanB = b.span ?? AGENT_SPAN
                const apart =
                    a.position.col + spanA <= b.position.col ||
                    b.position.col + spanB <= a.position.col ||
                    a.position.row + spanA <= b.position.row ||
                    b.position.row + spanB <= a.position.row
                expect(apart, `${a.id} et ${b.id} se chevauchent`).toBe(true)
            }
        }
    })

    it('donne à chaque box entre 2 et 6 connecteurs, et pas toujours le même nombre', () => {
        const counts = stage.containers.map(container => cableRoutes.filter(cable => containerOf(cable.sourceId) === container.id).length)

        for (const count of counts) {
            expect(count).toBeGreaterThanOrEqual(2)
            expect(count).toBeLessThanOrEqual(6)
        }
        expect(new Set(counts).size).toBeGreaterThan(1)
    })

    it('ne pose jamais deux fois le même outil', () => {
        const services = cableRoutes.map(cable => tileById.get(cable.targetId)?.ariaLabel)
        expect(new Set(services).size).toBe(services.length)
    })

    it('garde chaque connecteur dans la bande visible', () => {
        for (const cable of cableRoutes) {
            const cell = tileById.get(cable.targetId)!.position
            expect(Math.abs((cell.col - cell.row) * 28 + 28), `${cable.targetId} sort du cadre`).toBeLessThanOrEqual(400)
        }
    })
})

const script = stage.script
const changes = script.frames.flatMap(frame => frame.changes.map(change => ({ ...change, at: frame.at })))
const statusChanges = changes.filter(
    (change): change is typeof change & { status: NonNullable<typeof change.status> } => change.status !== undefined,
)
const agentIds = new Set(stage.agentIds)
const beams = stage.links.filter(link => link.variant === 'beam')
const agentBeams = beams.filter(beam => agentIds.has(beam.source) && agentIds.has(beam.target))
const toolBeams = beams.filter(beam => !agentIds.has(beam.target))

describe('le scénario du décor', () => {
    it('laisse le plateau respirer puis réveille les premiers agents un par un', () => {
        const lastCableEnd = Math.max(...stage.appearDelays.values()) + CABLE_DRAW_MS
        expect(script.startAt - lastCableEnd, 'le travail commence dans la chute des tuiles').toBeGreaterThanOrEqual(800)

        const opening = statusChanges
            .filter(change => change.status === 'working' && change.at < 10_000)
            .sort((a, b) => a.at - b.at)

        expect(opening).toHaveLength(4)
        for (let index = 1; index < opening.length; index++) {
            expect(opening[index].at - opening[index - 1].at, 'deux agents se réveillent presque ensemble').toBeGreaterThanOrEqual(1_200)
        }
    })

    it('fait travailler tous les agents', () => {
        const working = new Set(statusChanges.filter(change => change.status === 'working').map(change => change.agent))
        expect([...stage.agentIds].filter(id => !working.has(id))).toEqual([])
    })

    it('allume un lien connu pour chaque chose que le script fait', () => {
        const known = new Set([...cableRoutes.map(cable => cable.id), ...beams.map(beam => stageLinkId(beam.source, beam.target))])
        const missing = changes.flatMap(change => change.links ?? []).filter(link => !known.has(link))
        expect(missing).toEqual([])
    })

    it('ne relie jamais deux agents par un câble', () => {
        const wrong = cableRoutes.filter(cable => agentIds.has(cable.targetId))
        expect(wrong.map(cable => cable.id)).toEqual([])
    })

    it('double chaque câble d\'un beam, pour que l\'appel en cours se distingue de la plomberie', () => {
        const cables = cableRoutes.map(cable => cable.id).sort()
        const doubled = toolBeams.map(beam => stageLinkId(beam.source, beam.target)).sort()
        expect(doubled).toEqual(cables)

        const litByScript = new Set(changes.flatMap(change => change.links ?? []))
        expect(cables.filter(id => !litByScript.has(id)), 'un outil branché que personne n\'ouvre').toEqual([])
    })

    it('fait attendre un humain au moins deux fois par cycle, assez longtemps pour être lu', () => {
        const waits = statusChanges.filter(change => change.status === 'waiting_human')
        expect(waits.length).toBeGreaterThanOrEqual(2)
        expect(waits[0]?.at, 'la première demande humaine arrive trop tard').toBeLessThanOrEqual(15_000)

        for (const wait of waits) {
            const own = statusChanges.filter(change => change.agent === wait.agent).sort((a, b) => a.at - b.at)
            const index = own.indexOf(wait)
            const previous = own[index - 1]
            const next = own[index + 1]
            expect(previous?.status, `${wait.agent} attend sans avoir travaillé`).toBe('working')
            expect(next, `${wait.agent} reste en attente jusqu'à la fin du cycle`).toBeDefined()
            expect(next.status, `${wait.agent} ne reprend pas après le feu vert`).toBe('working')
            expect(next.at - wait.at, `l'attente de ${wait.agent} passe trop vite`).toBeGreaterThanOrEqual(10_000)
            expect(next.at - wait.at, `l'attente de ${wait.agent} dure trop longtemps`).toBeLessThanOrEqual(30_000)
        }
    })

    it('fait collaborer les boxes entre elles, dans les deux sens de chaque diagonale', () => {
        const pairs = new Set(
            agentBeams
                .filter(beam => containerOf(beam.source) !== containerOf(beam.target))
                .map(beam => `${containerOf(beam.source)}->${containerOf(beam.target)}`),
        )

        expect([...pairs].sort()).toEqual([
            'auth-box-content->auth-box-support',
            'auth-box-growth->auth-box-revenue',
            'auth-box-revenue->auth-box-growth',
            'auth-box-support->auth-box-content',
        ])
    })

    it('ne fait partir aucune passe inter-box en coude', () => {
        for (const beam of agentBeams) {
            if (containerOf(beam.source) === containerOf(beam.target)) continue

            const source = tileById.get(beam.source)!
            const target = tileById.get(beam.target)!
            const du = Math.abs(target.position.col - source.position.col)
            const dv = Math.abs(target.position.row - source.position.row)
            expect(Math.min(du, dv), `${stageLinkId(beam.source, beam.target)} part en coude`).toBeLessThanOrEqual(3)
        }
    })

    const collaborations = (() => {
        const held = new Map<string, string[]>()
        const open = new Map<string, number>()
        const out: { link: string; from: number; to: number }[] = []

        for (const frame of [...script.frames, { at: script.period, changes: [] }]) {
            for (const change of frame.changes) if (change.links !== undefined) held.set(change.agent, change.links)

            const holders = new Map<string, number>()
            for (const links of held.values()) for (const link of links) holders.set(link, (holders.get(link) ?? 0) + 1)

            for (const [link, count] of holders) if (count >= 2 && !open.has(link)) open.set(link, frame.at)
            for (const [link, from] of open) {
                if ((holders.get(link) ?? 0) >= 2) continue
                out.push({ link, from, to: frame.at })
                open.delete(link)
            }
        }

        return out
    })()

    it('fait travailler des agents ensemble, assez longtemps pour qu\'on les regarde', () => {
        expect(collaborations.length).toBeGreaterThanOrEqual(3)

        for (const collaboration of collaborations) {
            expect(collaboration.to - collaboration.from, `${collaboration.link} à ${collaboration.from}ms passe trop vite`).toBeGreaterThanOrEqual(10_000)
        }
    })

    it('fait collaborer au moins deux paires de boxes différentes, pas seulement des voisins', () => {
        const boxPairs = collaborations
            .map(collaboration => agentBeams.find(beam => stageLinkId(beam.source, beam.target) === collaboration.link))
            .filter(beam => beam !== undefined)
            .filter(beam => containerOf(beam.source) !== containerOf(beam.target))
            .map(beam => [containerOf(beam.source), containerOf(beam.target)].sort().join('+'))

        expect(new Set(boxPairs).size).toBeGreaterThanOrEqual(2)
    })

    it('joue les statuts utiles à l’auth sans jamais passer en erreur', () => {
        const played = new Set(statusChanges.map(change => change.status))
        expect([...played].sort()).toEqual(['idle', 'waiting_human', 'working'])
    })

    it('garde toujours quelques tuiles allumées, sans jamais éclairer tout le plateau', () => {
        const status = new Map<string, string>()
        let dark = 0
        let peak = 0
        let samples = 0
        let index = 0

        for (let t = 0; t <= script.period; t += 500) {
            while (index < script.frames.length && script.frames[index].at <= t) {
                for (const change of script.frames[index].changes) {
                    if (change.status !== undefined) status.set(change.agent, change.status)
                }
                index++
            }
            const lit = [...status.values()].filter(value => value !== 'idle').length
            peak = Math.max(peak, lit)
            if (lit === 0) dark++
            samples++
        }

        expect(peak, 'tout le plateau s\'allume en même temps').toBeLessThanOrEqual(stage.agentIds.length - 3)
        expect(dark / samples, 'le plateau est éteint trop souvent').toBeLessThanOrEqual(0.1)
    })

    it('garde chaque statut entre 10 et 30 secondes, raccord de boucle compris', () => {
        for (const agent of stage.agentIds) {
            const own = statusChanges.filter(change => change.agent === agent).sort((a, b) => a.at - b.at)

            own.forEach((change, index) => {
                let offset = 1
                let next = own[(index + offset) % own.length]
                while (next.status === change.status && offset <= own.length) {
                    offset++
                    next = own[(index + offset) % own.length]
                }
                const wrapped = index + offset >= own.length
                const duration = next.at + (wrapped ? script.period : 0) - change.at
                expect(duration, `${agent} garde ${change.status} trop peu longtemps à ${change.at}ms`).toBeGreaterThanOrEqual(10_000)
                expect(duration, `${agent} garde ${change.status} trop longtemps à ${change.at}ms`).toBeLessThanOrEqual(30_000)
            })
        }
    })

    it('laisse plusieurs agents au travail en même temps, sans jamais allumer tout le plateau', () => {
        const working = new Map<string, boolean>()
        let peak = 0
        let total = 0
        let samples = 0
        let index = 0

        for (let t = 0; t <= script.period; t += 500) {
            while (index < script.frames.length && script.frames[index].at <= t) {
                for (const change of script.frames[index].changes) {
                    if (change.status !== undefined) working.set(change.agent, change.status === 'working')
                }
                index++
            }
            const count = [...working.values()].filter(Boolean).length
            peak = Math.max(peak, count)
            total += count
            samples++
        }

        expect(peak, 'jamais plus de deux agents ensemble').toBeGreaterThanOrEqual(3)
        expect(peak, 'tout le plateau clignote en même temps').toBeLessThanOrEqual(stage.agentIds.length - 3)
        expect(total / samples, 'le décor a l\'air éteint').toBeGreaterThanOrEqual(2)
    })
})
