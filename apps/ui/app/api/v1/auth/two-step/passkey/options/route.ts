import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { hasTwoStep } from '@/lib/auth/two-step/gate'
import { passkeySignInOptions } from '@/lib/auth/two-step/passkeys'
import { getBrand } from '@/lib/brand/server'
import { failure } from '@/lib/i18n/action-error'
import { createSessionlessClient, getRequestAccessToken } from '@/supabase/server'
import { isWhiteLabel, mobileApi, type PasskeyOptions } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The app's second step by a passkey, first half: the options of a WebAuthn sign-in for its session,
// which still owes that step. Null when the account has no passkey, or on an organization's address.
export const POST = apiRoute(mobileApi.passkeyOptions, { auth: 'public' }, async (): Promise<PasskeyOptions | Response> => {
    const accessToken = await getRequestAccessToken()
    const { data } = accessToken ? await createSessionlessClient().auth.getUser(accessToken) : { data: { user: null } }
    if (!data.user || data.user.is_anonymous) {
        const { error } = failure('notAuthenticated')
        return Response.json({ error, code: 'notAuthenticated' }, { status: 401 })
    }
    if (!hasTwoStep(data.user.app_metadata) || isWhiteLabel(await getBrand())) return { options: null }
    const options = await passkeySignInOptions(data.user.id)
    if (!options) return { options: null }
    return { options: { ...options, allowCredentials: options.allowCredentials?.map(credential => ({ id: credential.id, type: 'public-key' as const, transports: credential.transports })) } }
})
