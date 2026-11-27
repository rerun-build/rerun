import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { hasTwoStep } from '@/lib/auth/two-step/gate'
import { signInWithPasskey } from '@/lib/auth/two-step/passkeys'
import { failure, type ErrorCode } from '@/lib/i18n/action-error'
import { createSessionlessClient, getRequestAccessToken } from '@/supabase/server'
import { mobileApi, type RaisedSession } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

function refused(status: number, code: ErrorCode): Response {
    const { error } = failure(code)
    return Response.json({ error, code }, { status })
}

// The app's second step by a passkey, second half: the device's signed answer, checked by the hub,
// then the session handed over is raised and handed back, as with a backup code.
export const POST = apiRoute(mobileApi.signInWithPasskey, { auth: 'public' }, async ({ body }): Promise<RaisedSession | Response> => {
    const accessToken = await getRequestAccessToken()
    if (!accessToken) return refused(401, 'notAuthenticated')
    const client = createSessionlessClient()
    const { data, error } = await client.auth.setSession({ access_token: accessToken, refresh_token: body.refreshToken })
    if (error || !data.user || data.user.is_anonymous) return refused(401, 'notAuthenticated')
    if (!hasTwoStep(data.user.app_metadata)) return refused(400, 'passkeyRefused')

    const { assertion } = body
    const response = {
        ...assertion,
        response: { ...assertion.response, userHandle: assertion.response.userHandle ?? undefined },
        clientExtensionResults: {},
        authenticatorAttachment: assertion.authenticatorAttachment ?? undefined,
    }
    const result = await signInWithPasskey(client, data.user.id, response)
    if (!result.ok) return result.reason === 'too_many' ? refused(429, 'backupCodeTooManyTries') : refused(400, 'passkeyRefused')
    return { session: { accessToken: result.accessToken, refreshToken: result.refreshToken } }
})
