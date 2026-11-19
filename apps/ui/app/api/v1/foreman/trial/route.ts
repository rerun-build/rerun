import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { startAppTrial } from '@/app/api/v1/onboarding/_lib/start-trial'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The app builds already in the stores start their trial here.
export const POST = apiRoute(mobileApi.startForemanTrial, { auth: 'admin' }, startAppTrial)
