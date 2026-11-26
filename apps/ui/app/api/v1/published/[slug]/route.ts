import { getPublishedAction, updatePublishedAccessAction } from '@/app/api/_actions/publish.actions'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi, publishedLinkSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The link as it stands now, for the chat's card: the tool output it was drawn from is frozen.
export const GET = apiRoute(mobileApi.getPublishedLink, { auth: 'member' }, async ({ params }) => {
    const file = await getPublishedAction(params.slug)
    return { file: file && publishedLinkSchema.parse(file) }
})

// "Make public" under a link a coworker asked to open to anyone: the same change as the web's card.
export const PATCH = apiRoute(mobileApi.makePublishedLinkPublic, { auth: 'member' }, async ({ params, body }) => {
    const changed = await updatePublishedAccessAction(params.slug, { access: body.access })
    if (!changed.ok) throw new ApiError(400, changed)
    return { file: publishedLinkSchema.parse(changed.file) }
})
