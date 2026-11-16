import { saveForemanIntakeAction } from '@/app/api/_actions/foreman-intake.actions'
import { countLegacyOnboardingCall } from '@/lib/onboarding/legacy-routes'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { foremanIntakeSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The welcome card's answers: writes the profile and closes discovery, as the web card does.
export const POST = apiRoute({ auth: 'member', body: foremanIntakeSchema }, ({ req, ctx, body }) => {
    countLegacyOnboardingCall(req, 'v1_intake', ctx.userId)
    return saveForemanIntakeAction(body)
})
