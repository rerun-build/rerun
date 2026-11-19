import { apiRoute } from '@/app/api/v1/_lib/api-route'
import type { ForemanTrialResult } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'admin' }, async (): Promise<ForemanTrialResult> => ({ entitled: true }))
