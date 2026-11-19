import { listWorkspaceInbox } from '@/app/api/_services/inbox.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.getInbox, { auth: 'member' }, async ({ ctx }) => listWorkspaceInbox(ctx))
