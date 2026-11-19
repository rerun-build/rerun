import { patchNotificationPrefs, readNotificationPrefs } from '@/app/api/_services/notification-prefs.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.getNotificationPrefs, { auth: 'user' }, async ({ ctx }) => readNotificationPrefs(ctx.user.id))

export const PATCH = apiRoute(mobileApi.updateNotificationPrefs, { auth: 'user' }, async ({ ctx, body }) => patchNotificationPrefs(ctx.user.id, body))
