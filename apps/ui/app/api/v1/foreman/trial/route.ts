import { ENGINE_WAITLIST_MESSAGE, startCardlessTrial } from '@/ee/services/billing.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { appPlatformOf } from '@/app/api/v1/_lib/client-platform'
import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { mergeForeman } from '@/lib/foreman/profile'
import { PHONE_REQUIRED_MESSAGE } from '@/lib/phone/verification'
import type { ForemanTrialResult } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The "Build my team" button of the app: the trial without a card, whatever the arm of the trial
// test, since the app sells nothing. The answer only says whether the workspace is now on; the build
// itself is the next turn of the onboarding conversation.
export const POST = apiRoute({ auth: 'admin' }, async ({ req, ctx }): Promise<ForemanTrialResult> => {
    const platform = appPlatformOf(req)
    const alreadyOn = isSubscriptionEntitled(ctx.workspace.subscription_status)
    let entitled: boolean
    try {
        entitled = await startCardlessTrial(platform)
    } catch (err) {
        const message = err instanceof Error ? err.message : ''
        if (message === PHONE_REQUIRED_MESSAGE || message === ENGINE_WAITLIST_MESSAGE) throw new ApiError(409, message)
        throw err
    }
    if (entitled && !alreadyOn) await mergeForeman(ctx, { trialStartedIn: platform })
    return { entitled }
})
