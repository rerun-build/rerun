import { setCoworkerRoutineEnabled } from '@/app/api/_services/coworker-details.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { ENGINE_PATH_ID } from '@/app/api/v1/_lib/path-ids'
import { routineKindSchema, updateRoutineSchema } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const PATCH = apiRoute({ auth: 'member', body: updateRoutineSchema }, async ({ ctx, params, body }) => {
    const kind = routineKindSchema.safeParse(params.kind)
    if (!kind.success || !ENGINE_PATH_ID.test(params.slug)) throw new ApiError(404, 'Routine not found')
    await setCoworkerRoutineEnabled(ctx, params.id, kind.data, params.slug, body.enabled)
})
