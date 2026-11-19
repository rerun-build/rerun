import { loadMe } from '@/app/api/_services/me.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.getMe, { auth: 'member' }, async ({ ctx }) => loadMe(ctx))
