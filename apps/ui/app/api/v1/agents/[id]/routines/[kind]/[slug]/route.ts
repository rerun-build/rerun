import { setCoworkerRoutineEnabled } from '@/app/api/_services/coworker-details.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { refusal } from '@/lib/i18n/action-error'
import { ENGINE_PATH_ID } from '@/app/api/v1/_lib/path-ids'
import { routineKindSchema, updateRoutineSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const PATCH = apiRoute({ auth: 'member', body: updateRoutineSchema }, async ({ ctx, params, body }) => {
    const kind = routineKindSchema.safeParse(params.kind)
    if (!kind.success || !ENGINE_PATH_ID.test(params.slug)) throw new ApiError(404, refusal('routineNotFound'))
    await setCoworkerRoutineEnabled(ctx, params.id, kind.data, params.slug, body.enabled)
})
