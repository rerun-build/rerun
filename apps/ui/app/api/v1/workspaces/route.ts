import { listUserWorkspaces } from '@/app/api/_services/workspace.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.listWorkspaces, { auth: 'user' }, async ({ ctx }) => listUserWorkspaces(ctx.supabase, ctx.user.id))
