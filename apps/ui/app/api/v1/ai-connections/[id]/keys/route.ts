import { updateAiConnectionKeys } from '@/app/api/_services/ai-connection.service'
import { connectionTarget } from '@/app/api/v1/ai-connections/_lib/target'
import { answeringConnectionErrors } from '@/app/api/v1/_lib/ai-connection-errors'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { refusal } from '@/lib/i18n/action-error'
import { CONNECTION_SATELLITE_KEYS, CONNECTION_TOKEN_KEY, RERUN_CONNECTION_ID, replaceAiConnectionKeyInputSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The new key of an API key connection, or a Claude setup-token pasted by hand. It carries no refresh
// material, so whatever an earlier sign-in left behind goes with it, as on the web: the engine would
// otherwise keep refreshing against a lineage this token does not belong to.
export const PUT = apiRoute({ auth: 'admin', body: replaceAiConnectionKeyInputSchema }, async ({ ctx, params, body }) =>
    answeringConnectionErrors(async () => {
        const target = await connectionTarget(ctx.workspace.id, params.id)
        if (target.id === RERUN_CONNECTION_ID) throw new ApiError(404, refusal('providerGoneFromMachine'))
        await updateAiConnectionKeys(ctx.workspace.id, target.id, { set: { [CONNECTION_TOKEN_KEY[target.provider]]: body.apiKey }, remove: CONNECTION_SATELLITE_KEYS[target.provider] })
    })
)
