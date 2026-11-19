import { finishTakeoverAction, startTakeoverAction } from '@/app/api/_actions/desktop.actions'
import { ApiError, apiRoute, deniedStatus } from '@/app/api/v1/_lib/api-route'
import { mobileApi, type TakeoverResult } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The coworker's own browser on its screen, for the person to drive: where it asked, or where it was.
export const POST = apiRoute(mobileApi.startTakeover, { auth: 'member' }, async ({ params, body }) => {
    const started = await startTakeoverAction(params.id, body.url)
    if (!started.ok) throw new ApiError(deniedStatus(started.denied, 503), started)
})

// Handed back: the page it was left on goes back to the coworker in the answer.
export const DELETE = apiRoute(mobileApi.finishTakeover, { auth: 'member' }, async ({ params, query }): Promise<TakeoverResult> => {
    const finished = await finishTakeoverAction(params.id, { keepOpen: query.keepOpen === '1' })
    if (!finished.ok) throw new ApiError(deniedStatus(finished.denied, 503), finished)
    return { url: finished.url, open: finished.open }
})
