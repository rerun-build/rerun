import { ENGINE_WAITLIST_MESSAGE, startCardlessTrial } from '@/ee/services/billing.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { appPlatformOf } from '@/app/api/v1/_lib/client-platform'
import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { storeProductId } from '@/ee/lib/billing/store/products'
import { mergeForeman } from '@/lib/foreman/profile'
import { PHONE_REQUIRED_MESSAGE } from '@/lib/phone/verification'
import { storeProviderOf, type ForemanTrialResult } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The "Build my team" button of the app builds from before the stores sold the plan: it started the
// trial without a card. Once this deployment sells through the app's store, the trial is the store's
// and this route starts nothing: a build that still calls it hears `purchase_required`, and the
// minimum build sends it to the store for the one that sells. Until then it keeps starting the
// cardless trial, so a deploy never strands the builds already out there.
export const POST = apiRoute({ auth: 'admin' }, async ({ req, ctx }): Promise<ForemanTrialResult> => {
    const platform = appPlatformOf(req)
    const alreadyOn = isSubscriptionEntitled(ctx.workspace.subscription_status)
    if (storeProductId(storeProviderOf(platform))) return alreadyOn ? { entitled: true } : { entitled: false, reason: 'purchase_required' }

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
