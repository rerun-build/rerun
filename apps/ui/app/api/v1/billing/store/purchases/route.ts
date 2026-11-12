import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { InvalidStorePurchaseError, recordStorePurchase } from '@/ee/services/store-billing.service'
import { storePurchaseRequestSchema, type StorePurchaseResult } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// A purchase or a restore from the app: the store's transaction, verified with the store and applied
// to the caller's workspace. A refusal the app can explain is a 200 with its reason; a transaction
// that does not verify is a 400, and anything else a 500 the app retries with the same transaction.
export const POST = apiRoute({ auth: 'admin', body: storePurchaseRequestSchema }, async ({ ctx, body }): Promise<StorePurchaseResult> => {
    try {
        return await recordStorePurchase(ctx, body)
    } catch (err) {
        if (err instanceof InvalidStorePurchaseError) throw new ApiError(400, err.message)
        throw err
    }
})
