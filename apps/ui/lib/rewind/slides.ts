import type { RewindPayload } from '@rerun/contracts'

export const REWIND_SLIDE_IDS = ['intro', 'hours', 'rhythm', 'clock', 'mvp', 'connectors', 'highlights', 'memory', 'awards', 'outro'] as const
export type RewindSlideId = (typeof REWIND_SLIDE_IDS)[number]

const MIN_RUNS_FOR_CLOCK = 5

const INCLUDED: Record<RewindSlideId, (payload: RewindPayload) => boolean> = {
    intro: () => true,
    hours: p => p.totals.workedMs > 0,
    rhythm: p => p.totals.runs > 0,
    clock: p => p.totals.runs >= MIN_RUNS_FOR_CLOCK,
    mvp: p => p.mvpAgentId !== null,
    connectors: p => p.connectors.length > 0,
    highlights: p => p.highlights.length > 0,
    memory: p => p.totals.memoriesCreated > 0 || p.topMemory !== null,
    awards: p => p.awards.length > 0,
    outro: () => true,
}

export function rewindSlides(payload: RewindPayload): RewindSlideId[] {
    return REWIND_SLIDE_IDS.filter(id => INCLUDED[id](payload))
}
