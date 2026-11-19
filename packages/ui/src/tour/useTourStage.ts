'use client'

import { useTourBeat } from './useTourBeat'
import { LAST_TOUR_PHASE, TOUR_AGENTS_PHASE, TOUR_HANDOFFS, TOUR_MODEL_PHASE, boardForPhase, isTourFocusPhase } from './tour-board'
import { TOUR_LIFE_BEATS, TOUR_LIFE_START, TOUR_LIFE_STILL, type TourLifeStatus, tourLifeAt } from './tour-life'
import { TOUR_MODEL_BEATS, TOUR_MODEL_PILLS_START, type TourModelPill, type TourModelShot, tourModelPillsAt, tourModelStillPills } from './tour-models'
import { TOUR_TEAM_BEATS, TOUR_TEAM_STILL_BEAT, tourTeamStateAt } from './tour-team'
import { ISO_DIM_MS } from '../iso-grid/iso'
import { agentTileStyle } from '../iso-grid/presets'
import { usePrefersReducedMotion } from '../iso-grid/hooks/usePrefersReducedMotion'
import { useKitTranslations } from '../locale'
import type { Tile, TileLink } from '../iso-grid/types'
import { useEffect, useMemo, useState } from 'react'

// Everything the tour board shows at a given slide. The phase drives the words, the shot and the
// team. What is standing on the plateau follows it in both directions, one beat behind on the way
// back (cf. usePlateau).

const NO_PILLS: TourModelPill[] = []
const NO_STATUSES: Record<string, TourLifeStatus> = {}

// What the plateau is holding, in two numbers.
//
// `rendered` is the phase the board is drawn at: the slide's own on the way out, one beat behind it
// on the way back. A piece leaving is put in retreat by boardForPhase and dropped from the array
// only once it has faded, because the grid has no exit animation for a tile — taken out on the spot,
// eight tools would blink off the plateau in a single frame. Going forward again cancels the timer,
// so a Back immediately followed by a Continue never empties anything.
//
// `landing` is the phase playing its arrival, and it is **state** rather than a comparison redone
// every render: the pieces of a landing phase carry `justPlaced`, whose CSS animation shorthand has
// to stay identical across re-renders or the tiles snap to rest mid-fall. It is set on the way out,
// which is the only direction anything arrives in, and cleared when the plateau finishes shrinking —
// a phase emptied and walked back into is a phase that lands again.
function usePlateau(phase: number) {
    const [plateau, setPlateau] = useState({ rendered: phase, landing: phase as number | null })
    if (phase > plateau.rendered) setPlateau({ rendered: phase, landing: phase })

    useEffect(() => {
        if (phase >= plateau.rendered) return
        const timer = setTimeout(() => setPlateau({ rendered: phase, landing: null }), ISO_DIM_MS)
        return () => clearTimeout(timer)
    }, [phase, plateau.rendered])

    return plateau
}

export type TourStage = {
    tiles: Tile[]
    containers: ReturnType<typeof boardForPhase>['containers']
    links: TileLink[]
    cursorsAt: Record<string, string>
    presentIds: readonly string[]
    modelPills: readonly TourModelPill[]
}

// `focused` is the close-up on one Box. It defaults to the tour's own reading of the phase, and is a
// parameter rather than a derivation because a surface that plays the scene without the words has no
// reason to close in: the close-up exists to make eight tools landing at once readable while a slide
// is being read, and a decor has nothing to read.
export function useTourStage({ phase, active, modelShot, focused = isTourFocusPhase(phase) }: { phase: number; active: boolean; modelShot: TourModelShot | null; focused?: boolean }): TourStage {
    const still = usePrefersReducedMotion()
    const t = useKitTranslations()
    const { rendered, landing } = usePlateau(phase)
    // The model marks are lit from the frame they land on and are never put out again: the halo is
    // part of the mark, like its logo, not a spotlight the slides take turns pointing at it. Read off
    // the rendered phase and not the slide's, so the four marks keep their halo all the way through
    // the fade that takes them off instead of going dark a beat before they leave.
    const lit = rendered >= TOUR_MODEL_PHASE
    const board = useMemo(() => boardForPhase(rendered, { animatedPhase: still ? null : landing, lit, focused, livePhase: phase, t }), [rendered, phase, still, landing, lit, focused, t])

    // The agents wake once the phase that carries them has been reached, never before: a board of
    // Boxes with nothing in them has nobody to put to work. Held on the rendered phase, or seven
    // agents walking back onto the first slide would snap to idle in the middle of their own fade.
    const alive = active && !still && rendered >= TOUR_AGENTS_PHASE
    const statuses = useTourLife(alive, still)

    const team = useTourTeam(phase === LAST_TOUR_PHASE && active, still)
    // Held back only while the model marks are landing. Walking back onto the slide from the tools
    // finds them already standing, so the badges have nothing to wait for.
    const modelPills = useTourModelPills(phase === TOUR_MODEL_PHASE && active, still, landing === TOUR_MODEL_PHASE, modelShot)

    const tiles = useMemo(() => {
        if (!alive && !still) return board.tiles
        return board.tiles.map(tile => {
            const status = statuses[tile.id]
            // `idle` falls back to the tile's own style: a connector has no status, and
            // agentTileStyle would repaint it as an agent block.
            return status && status !== 'idle' ? { ...tile, style: agentTileStyle(status, tile.ariaLabel ?? '') } : tile
        })
    }, [alive, still, board, statuses])

    // A cable is drawn once, when its connector lands, and is then left alone for the rest of the
    // tour: nothing in it lights up again because its agent went back to work. The one link that
    // moves is the hand-off of the last slide, and it is mounted only for as long as it lasts —
    // left standing it would read as plumbing, which is what the cable underneath already says.
    const links = useMemo(() => {
        const handoff = TOUR_HANDOFFS.find(h => h.id === team.handoff)
        return handoff ? [...board.links, { source: handoff.source, target: handoff.target, variant: 'beam' as const }] : board.links
    }, [board, team.handoff])

    return { tiles, containers: board.containers, links, cursorsAt: team.at, presentIds: team.present, modelPills }
}

// The written score the seven agents play, once the board they stand on has finished landing. Held
// back on the very first arming only: walking back onto an earlier slide finds a board that has been
// working for a while, and restarting it there would put every tile to sleep at once.
function useTourLife(alive: boolean, still: boolean): Record<string, TourLifeStatus> {
    const [armed, setArmed] = useState(false)

    useEffect(() => {
        if (!alive || armed) return
        const timer = setTimeout(() => setArmed(true), TOUR_LIFE_START)
        return () => clearTimeout(timer)
    }, [alive, armed])

    const tick = useTourBeat(TOUR_LIFE_BEATS, !alive || !armed)
    if (still) return TOUR_LIFE_STILL
    return alive && armed ? tourLifeAt(tick) : NO_STATUSES
}

// The subscription slide only: model badges surface over the plan and go again while the four model
// marks wire themselves in underneath.
function useTourModelPills(active: boolean, still: boolean, deferred: boolean, shot: TourModelShot | null): readonly TourModelPill[] {
    const [armed, setArmed] = useState(false)

    useEffect(() => {
        if (!active) return
        const timer = setTimeout(() => setArmed(true), deferred ? TOUR_MODEL_PILLS_START : 0)
        return () => clearTimeout(timer)
    }, [active, deferred])

    const tick = useTourBeat(TOUR_MODEL_BEATS, !active || !armed || still)
    if (!active || !shot) return NO_PILLS
    if (still) return tourModelStillPills(shot)
    return armed ? tourModelPillsAt(tick, shot) : NO_PILLS
}

// The last slide only: teammates walk the board and hand work over between agents. Nothing is
// narrated over the tiles, the agents' own statuses are what the slide has to say.
function useTourTeam(active: boolean, still: boolean) {
    const tick = useTourBeat(TOUR_TEAM_BEATS, !active || still)
    const beat = active ? (still ? TOUR_TEAM_STILL_BEAT : tick % TOUR_TEAM_BEATS.length) : 0
    const state = tourTeamStateAt(beat)

    // Read through `active` rather than emptied from an effect: leaving the slide has to take the
    // cursors with it on the very same frame.
    return { at: state.at, present: active ? state.present : [], handoff: active && !still ? state.handoff : undefined }
}
