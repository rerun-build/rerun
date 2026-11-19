import { saveForemanIntakeAction } from '@/app/api/_actions/foreman-intake.actions'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { foremanIntakeSchema } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member', body: foremanIntakeSchema }, ({ body }) => saveForemanIntakeAction(body))
