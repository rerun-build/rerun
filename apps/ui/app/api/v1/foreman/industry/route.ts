import { decideIndustryAction } from '@/app/api/_actions/foreman-intake.actions'
import { countLegacyOnboardingCall } from '@/lib/onboarding/legacy-routes'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { foremanIndustryRequestSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The fast guess at an industry from a site or a sentence, while the card is still being answered.
export const POST = apiRoute({ auth: 'member', body: foremanIndustryRequestSchema }, async ({ req, ctx, body }) => {
    countLegacyOnboardingCall(req, 'v1_industry', ctx.userId)
    return { industry: await decideIndustryAction(body.input) }
})
