import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { startAppTrial } from '@/app/api/v1/onboarding/_lib/start-trial'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(mobileApi.startOnboardingTrial, { auth: 'admin' }, startAppTrial)
