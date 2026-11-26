import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { signInWithBackupCode } from '@/lib/auth/two-step/backup-sign-in'
import { hasTwoStep } from '@/lib/auth/two-step/gate'
import { failure, type ErrorCode } from '@/lib/i18n/action-error'
import { createSessionlessClient, getRequestAccessToken } from '@/supabase/server'
import { mobileApi, type RaisedSession } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

function refused(status: number, code: ErrorCode): Response {
    const { error } = failure(code)
    return Response.json({ error, code }, { status })
}

// The app's second step by a backup code. Its session still owes that step, so the hub takes it for
// nobody on every other route: the session itself is handed over, raised here, and handed back.
export const POST = apiRoute(mobileApi.spendBackupCode, { auth: 'public' }, async ({ body }): Promise<RaisedSession | Response> => {
    const accessToken = await getRequestAccessToken()
    if (!accessToken) return refused(401, 'notAuthenticated')
    const client = createSessionlessClient()
    const { data, error } = await client.auth.setSession({ access_token: accessToken, refresh_token: body.refreshToken })
    if (error || !data.user || data.user.is_anonymous) return refused(401, 'notAuthenticated')
    if (!hasTwoStep(data.user.app_metadata)) return refused(400, 'backupCodeWrong')

    const result = await signInWithBackupCode(client, data.user.id, body.code)
    if (!result.ok) return result.reason === 'too_many' ? refused(429, 'backupCodeTooManyTries') : refused(400, 'backupCodeWrong')
    return { session: { accessToken: result.accessToken, refreshToken: result.refreshToken } }
})
