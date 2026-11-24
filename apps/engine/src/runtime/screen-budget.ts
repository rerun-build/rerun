import type { Provider } from '@rerun/contracts'
import { CLI_PROVIDERS } from '../agents/types.js'

// Nothing else ends a model that keeps clicking: the loop only stops on its own final answer. A CLI
// keeps every picture in its context, where the engine cannot drop the old ones: it works in
// stretches, each one a session of its own that holds none of the pictures before it.
const CAPTURES_PER_STRETCH = 60
const CAPTURES_PER_CLI_RUN = 600
const CAPTURES_PER_RUN = 200

// A caret that blinks or a pointer that moved is not a new screen; what a person would see change is.
const PIXEL_TOLERANCE = 24
const CHANGED_PIXELS_OF_A_NEW_VIEW = 60
const NEW_VIEWS_OF_A_STRETCH = 6

export type ScreenRefusal = 'carry-on' | 'stuck' | 'spent'

export type ScreenBudget = {
    /** Takes one screenshot of the run, or says why there is none left. */
    take: () => ScreenRefusal | null
    /** The small grey picture of what the last one showed. */
    saw: (view: Buffer) => void
    /** The stretch is used up and the run goes on in a new one. */
    carriesOn: () => boolean
    nextStretch: () => void
    /** How many stretches came before this one. */
    stretch: () => number
    perRun: number
    perStretch: number
}

function isSameView(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) return false
    let changed = 0
    for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i] - b[i]) <= PIXEL_TOLERANCE) continue
        if (++changed >= CHANGED_PIXELS_OF_A_NEW_VIEW) return false
    }
    return true
}

export function createScreenBudget(provider: Provider): ScreenBudget {
    const cli = CLI_PROVIDERS.has(provider)
    const perRun = cli ? CAPTURES_PER_CLI_RUN : CAPTURES_PER_RUN
    const perStretch = cli ? CAPTURES_PER_STRETCH : CAPTURES_PER_RUN
    const views: Buffer[] = []
    let stretch = 0
    let taken = 0
    let takenInStretch = 0
    let newViewsInStretch = 0
    let asked = false

    const refusal = (): ScreenRefusal | null => {
        if (taken >= perRun) return 'spent'
        if (takenInStretch < perStretch) return null
        return newViewsInStretch < NEW_VIEWS_OF_A_STRETCH ? 'stuck' : 'carry-on'
    }

    return {
        perRun,
        perStretch,
        take: () => {
            const refused = refusal()
            if (refused) {
                asked = true
                return refused
            }
            taken++
            takenInStretch++
            return null
        },
        saw: view => {
            if (!cli || views.some(seen => isSameView(seen, view))) return
            views.push(view)
            newViewsInStretch++
        },
        carriesOn: () => asked && refusal() === 'carry-on',
        nextStretch: () => {
            stretch++
            takenInStretch = 0
            newViewsInStretch = 0
            asked = false
        },
        stretch: () => stretch,
    }
}
