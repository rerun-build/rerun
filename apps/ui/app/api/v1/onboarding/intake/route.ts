import { saveWelcomeIntakeAction } from '@/app/api/_actions/welcome.actions'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { foremanIntakeSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'admin', body: foremanIntakeSchema }, ({ body }) => saveWelcomeIntakeAction(body))
