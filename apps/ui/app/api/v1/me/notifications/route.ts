import { patchNotificationPrefs, readNotificationPrefs } from '@/app/api/_services/notification-prefs.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { notificationPrefsPatchSchema } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'user' }, async ({ ctx }) => readNotificationPrefs(ctx.user.id))

export const PATCH = apiRoute({ auth: 'user', body: notificationPrefsPatchSchema }, async ({ ctx, body }) => patchNotificationPrefs(ctx.user.id, body))
