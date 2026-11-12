import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { appPlatformOf } from '@/app/api/v1/_lib/client-platform'
import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { InvalidStorePurchaseError, recordStorePurchase } from '@/ee/services/store-billing.service'
import { mergeForeman } from '@/lib/foreman/profile'
import { storePurchaseRequestSchema, type StorePurchaseResult } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// A purchase or a restore from the app: the store's transaction, verified with the store and applied
// to the caller's workspace. A refusal the app can explain is a 200 with its reason; a transaction
// that does not verify is a 400, and anything else a 500 the app retries with the same transaction.
export const POST = apiRoute({ auth: 'admin', body: storePurchaseRequestSchema }, async ({ req, ctx, body }): Promise<StorePurchaseResult> => {
    const alreadyOn = isSubscriptionEntitled(ctx.workspace.subscription_status)
    let result: StorePurchaseResult
    try {
        result = await recordStorePurchase(ctx, body)
    } catch (err) {
        if (err instanceof InvalidStorePurchaseError) throw new ApiError(400, err.message)
        throw err
    }
    // Where the trial started, as the cardless one marked it: the trial test's table leaves the app's out.
    if (result.ok && result.status === 'trialing' && !alreadyOn) await mergeForeman(ctx, { trialStartedIn: appPlatformOf(req) })
    return result
})
