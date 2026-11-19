import { saveWelcomeIntakeAction } from '@/app/api/_actions/welcome.actions'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(mobileApi.saveOnboardingIntake, { auth: 'admin' }, ({ body }) => saveWelcomeIntakeAction(body))
