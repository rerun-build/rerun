import { finishTakeoverAction, startTakeoverAction } from '@/app/api/_actions/desktop.actions'
import { ApiError, apiRoute, deniedStatus } from '@/app/api/v1/_lib/api-route'
import { takeoverRequestSchema, type TakeoverResult } from '@rerun/contracts'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// The coworker's own browser on its screen, for the person to drive: where it asked, or where it was.
export const POST = apiRoute({ auth: 'member', body: takeoverRequestSchema }, async ({ params, body }) => {
    const started = await startTakeoverAction(params.id, body.url)
    if (!started.ok) throw new ApiError(deniedStatus(started.denied, 503), started.error)
})

// keepOpen=1 when the person hands the browser back to the run that asked for it: the window stays on
// the coworker's screen. Without it (skipped, or a browser opened by hand), the window closes.
const finishQuery = z.object({ keepOpen: z.literal('1').optional() })

// Handed back: the page it was left on goes back to the coworker in the answer.
export const DELETE = apiRoute({ auth: 'member', query: finishQuery }, async ({ params, query }): Promise<TakeoverResult> => {
    const finished = await finishTakeoverAction(params.id, { keepOpen: query.keepOpen === '1' })
    if (!finished.ok) throw new ApiError(deniedStatus(finished.denied, 503), finished.error)
    return { url: finished.url, open: finished.open }
})
