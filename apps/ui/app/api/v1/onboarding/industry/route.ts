import { decideIndustryAction } from '@/app/api/_actions/foreman-intake.actions'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The fast guess at an industry from a site or a sentence, while the questions are still being answered.
export const POST = apiRoute(mobileApi.decideOnboardingIndustry, { auth: 'admin' }, async ({ body }) => ({ industry: await decideIndustryAction(body.input) }))
