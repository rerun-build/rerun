import type { RewindPayload } from '@moldwright/contracts'
import { describe, expect, it } from 'vitest'
import { REWIND_SLIDE_IDS, rewindSlides } from './slides'

function payload(overrides: { totals?: Partial<RewindPayload['totals']> } & Partial<Omit<RewindPayload, 'totals'>> = {}): RewindPayload {
    const { totals, ...rest } = overrides
    return {
        totals: { runs: 0, workedMs: 0, memoriesCreated: 0, ...totals },
        mvpAgentId: null,
        connectors: [],
        highlights: [],
        topMemory: null,
        awards: [],
        ...rest,
    } as unknown as RewindPayload
}

describe('rewindSlides', () => {
    it('keeps only the intro and the outro of an empty week', () => {
        expect(rewindSlides(payload())).toEqual(['intro', 'outro'])
    })

    it('shows every slide, in order, for a full week', () => {
        const full = payload({
            totals: { runs: 5, workedMs: 1, memoriesCreated: 1 },
            mvpAgentId: 'a1',
            connectors: [{}] as RewindPayload['connectors'],
            highlights: [{}] as RewindPayload['highlights'],
            awards: [{}] as RewindPayload['awards'],
        })
        expect(rewindSlides(full)).toEqual([...REWIND_SLIDE_IDS])
    })

    it('needs five runs before the clock slide means anything', () => {
        expect(rewindSlides(payload({ totals: { runs: 4 } }))).toEqual(['intro', 'rhythm', 'outro'])
        expect(rewindSlides(payload({ totals: { runs: 5 } }))).toContain('clock')
    })

    it('shows the memory slide for a top memory even with no memory created this week', () => {
        expect(rewindSlides(payload({ topMemory: { agentId: 'a1', content: 'x', accessCount: 3 } }))).toContain('memory')
    })
})
