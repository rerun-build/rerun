import { decideIndustryAction } from '@/app/api/_actions/foreman-intake.actions'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { foremanIndustryRequestSchema } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member', body: foremanIndustryRequestSchema }, async ({ body }) => ({ industry: await decideIndustryAction(body.input) }))
