import { finishTakeoverAction, startTakeoverAction } from '@/app/api/_actions/desktop.actions'
import { ApiError, apiRoute, deniedStatus } from '@/app/api/v1/_lib/api-route'
import { takeoverRequestSchema, type TakeoverResult } from '@moldwright/contracts'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member', body: takeoverRequestSchema }, async ({ params, body }) => {
    const started = await startTakeoverAction(params.id, body.url)
    if (!started.ok) throw new ApiError(deniedStatus(started.denied, 503), started.error)
})

const finishQuery = z.object({ keepOpen: z.literal('1').optional() })

export const DELETE = apiRoute({ auth: 'member', query: finishQuery }, async ({ params, query }): Promise<TakeoverResult> => {
    const finished = await finishTakeoverAction(params.id, { keepOpen: query.keepOpen === '1' })
    if (!finished.ok) throw new ApiError(deniedStatus(finished.denied, 503), finished.error)
    return { url: finished.url, open: finished.open }
})
