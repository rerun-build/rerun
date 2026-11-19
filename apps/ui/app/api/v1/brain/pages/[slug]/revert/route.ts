import { revertBrainPageAction } from '@/app/api/_actions/brain.actions'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { brainRevertRequestSchema } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member', body: brainRevertRequestSchema }, async ({ params, body }) => {
    const reverted = await revertBrainPageAction(params.slug, body.revisionId, body.expectedHash)
    if (!reverted.ok) throw new ApiError(reverted.conflict ? 409 : 503, reverted.error)
})
