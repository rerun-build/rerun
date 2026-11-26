import { dismissAccessRequestAction } from '@/app/api/_actions/publish.actions'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// "Keep private": the link keeps its access and stops asking.
export const DELETE = apiRoute(mobileApi.dismissPublishedAccessRequest, { auth: 'member' }, async ({ params }) => {
    const dismissed = await dismissAccessRequestAction(params.slug)
    if (!dismissed.ok) throw new ApiError(400, dismissed)
})
