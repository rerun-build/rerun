import { revertBrainPageAction } from '@/app/api/_actions/brain.actions'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The chat's Undo on a Brain change: the page goes back to the revision it had before, unless it
// changed again since.
export const POST = apiRoute(mobileApi.revertBrainPage, { auth: 'member' }, async ({ params, body }) => {
    const reverted = await revertBrainPageAction(params.slug, body.revisionId, body.expectedHash)
    if (!reverted.ok) throw new ApiError(reverted.conflict ? 409 : 503, reverted)
})
