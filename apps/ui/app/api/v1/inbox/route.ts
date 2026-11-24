import { listWorkspaceInbox } from '@/app/api/_services/inbox.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { clientReadsForemanRuns } from '@/app/api/v1/_lib/legacy-client'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.getInbox, { auth: 'member' }, async ({ ctx, req }) => listWorkspaceInbox(ctx, { foremanRuns: clientReadsForemanRuns(req) }))
