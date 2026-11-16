import { TIME_ZONE_HEADER } from '@rerun/contracts'

import { stampActivity } from '@/app/api/_services/activity.service'
import { loadMe } from '@/app/api/_services/me.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'

export const dynamic = 'force-dynamic'

// Read on every launch of the app: the time zone of the phone, and that the member was here.
export const GET = apiRoute({ auth: 'member' }, async ({ ctx, req }) => {
    await stampActivity(ctx.userId, req.headers.get(TIME_ZONE_HEADER))
    return loadMe(ctx)
})
