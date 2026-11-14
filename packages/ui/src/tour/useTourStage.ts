'use client'

import { useTourBeat } from './useTourBeat'
import { LAST_TOUR_PHASE, TOUR_AGENTS_PHASE, TOUR_HANDOFFS, TOUR_MODEL_PHASE, boardForPhase, isTourFocusPhase } from './tour-board'
import { TOUR_LIFE_BEATS, TOUR_LIFE_START, TOUR_LIFE_STILL, type TourLifeStatus, tourLifeAt } from './tour-life'
import { TOUR_MODEL_BEATS, TOUR_MODEL_PILLS_START, type TourModelPill, type TourModelShot, tourModelPillsAt, tourModelStillPills } from './tour-models'
import { TOUR_TEAM_BEATS, TOUR_TEAM_STILL_BEAT, tourTeamStateAt } from './tour-team'
import { ISO_DIM_MS } from '../iso-grid/iso'
import { agentTileStyle } from '../iso-grid/presets'
import { usePrefersReducedMotion } from '../iso-grid/hooks/usePrefersReducedMotion'
import type { Tile, TileLink } from '../iso-grid/types'
import { useEffect, useMemo, useState } from 'react'

const NO_PILLS: TourModelPill[] = []
const NO_STATUSES: Record<string, TourLifeStatus> = {}

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

export function useTourStage({ phase, active, modelShot, focused = isTourFocusPhase(phase) }: { phase: number; active: boolean; modelShot: TourModelShot | null; focused?: boolean }): TourStage {
    const still = usePrefersReducedMotion()
    const { rendered, landing } = usePlateau(phase)
    const lit = rendered >= TOUR_MODEL_PHASE
    const board = useMemo(() => boardForPhase(rendered, { animatedPhase: still ? null : landing, lit, focused, livePhase: phase }), [rendered, phase, still, landing, lit, focused])

    const alive = active && !still && rendered >= TOUR_AGENTS_PHASE
    const statuses = useTourLife(alive, still)

    const team = useTourTeam(phase === LAST_TOUR_PHASE && active, still)
    const modelPills = useTourModelPills(phase === TOUR_MODEL_PHASE && active, still, landing === TOUR_MODEL_PHASE, modelShot)

    const tiles = useMemo(() => {
        if (!alive && !still) return board.tiles
        return board.tiles.map(tile => {
            const status = statuses[tile.id]
            return status && status !== 'idle' ? { ...tile, style: agentTileStyle(status, tile.ariaLabel ?? '') } : tile
        })
    }, [alive, still, board, statuses])

    const links = useMemo(() => {
        const handoff = TOUR_HANDOFFS.find(h => h.id === team.handoff)
        return handoff ? [...board.links, { source: handoff.source, target: handoff.target, variant: 'beam' as const }] : board.links
    }, [board, team.handoff])

    return { tiles, containers: board.containers, links, cursorsAt: team.at, presentIds: team.present, modelPills }
}

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

function useTourTeam(active: boolean, still: boolean) {
    const tick = useTourBeat(TOUR_TEAM_BEATS, !active || still)
    const beat = active ? (still ? TOUR_TEAM_STILL_BEAT : tick % TOUR_TEAM_BEATS.length) : 0
    const state = tourTeamStateAt(beat)

    return { at: state.at, present: active ? state.present : [], handoff: active && !still ? state.handoff : undefined }
}
