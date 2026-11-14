import { describe, expect, it } from 'vitest'

import { buildAuthStage } from './auth-stage-board'
import type { StageScript } from './auth-stage-board'
import { msToNextFrame, stagePlaybackAt } from './useStageScript'

const SCRIPT: StageScript = {
    startAt: 900,
    period: 10_000,
    frames: [
        { at: 0, changes: [{ agent: 'a', status: 'working', links: ['a->x'] }] },
        { at: 2_000, changes: [{ agent: 'b', status: 'working', links: ['b->a'] }] },
        { at: 4_000, changes: [{ agent: 'a', status: 'idle', links: [] }] },
        { at: 8_000, changes: [{ agent: 'b', status: 'waiting_human', links: [] }] },
    ],
}

function playedUpTo(script: StageScript, time: number) {
    const statuses: Record<string, string> = {}
    const hotLinks: Record<string, string[]> = {}
    let elapsed = 0

    while (elapsed <= time) {
        for (const frame of script.frames) {
            if (elapsed + frame.at > time) break
            for (const change of frame.changes) {
                if (change.status !== undefined) statuses[change.agent] = change.status
                if (change.links !== undefined) hotLinks[change.agent] = change.links
            }
        }
        elapsed += script.period
    }

    return { statuses, hotLinks }
}

describe('la lecture du scénario à une heure donnée', () => {
    it('ne joue rien avant le premier battement', () => {
        expect(stagePlaybackAt(SCRIPT, -1)).toEqual({ statuses: {}, hotLinks: {} })
    })

    it('donne la même image qu’une lecture image par image, cycle après cycle', () => {
        for (let time = 0; time <= SCRIPT.period * 3; time += 250) {
            expect(stagePlaybackAt(SCRIPT, time), `à ${time}ms`).toEqual(playedUpTo(SCRIPT, time))
        }
    })

    it('garde ce que le cycle précédent avait posé et que celui-ci n’a pas encore touché', () => {
        expect(stagePlaybackAt(SCRIPT, SCRIPT.period + 1_000).statuses.b).toBe('waiting_human')
    })

    it('ne réveille le lecteur que sur une image, jamais entre deux', () => {
        for (let time = -SCRIPT.startAt; time <= SCRIPT.period * 2; time += 137) {
            const delay = msToNextFrame(SCRIPT, time)
            expect(delay, `à ${time}ms`).toBeGreaterThan(0)
            expect(stagePlaybackAt(SCRIPT, time + delay - 1), `à ${time}ms`).toEqual(stagePlaybackAt(SCRIPT, time))
            expect(stagePlaybackAt(SCRIPT, time + delay), `à ${time}ms`).not.toEqual(stagePlaybackAt(SCRIPT, time))
        }
    })

    it('retombe sur une image du scénario de la scène plein cadre après une longue absence', () => {
        const { script } = buildAuthStage()
        const away = script.period * 41 + 12_345

        expect(stagePlaybackAt(script, away)).toEqual(stagePlaybackAt(script, script.period + 12_345))
    })
})
