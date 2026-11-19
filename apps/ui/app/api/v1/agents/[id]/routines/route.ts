import { listCoworkerRoutines } from '@/app/api/_services/coworker-details.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.listAgentRoutines, { auth: 'member' }, async ({ ctx, params }) => listCoworkerRoutines(ctx, params.id))
