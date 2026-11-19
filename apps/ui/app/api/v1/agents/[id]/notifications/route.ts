import { readCoworkerNotifications, setCoworkerNotifications } from '@/app/api/_services/coworker-details.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { coworkerNotificationsSchema } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'member' }, async ({ ctx, params }) => readCoworkerNotifications(ctx, params.id))

export const PUT = apiRoute({ auth: 'member', body: coworkerNotificationsSchema }, async ({ ctx, params, body }) => {
    await setCoworkerNotifications(ctx, params.id, body.mode)
})
