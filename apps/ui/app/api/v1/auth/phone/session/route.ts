import { completeAppReviewSignIn, completePhoneSignIn, countVerifyAttempt, VERIFY_WINDOW_MS } from '@/app/api/_services/phone-sign-in.service'
import { phoneRefused } from '@/app/api/v1/auth/_lib/refusal'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { isAppReviewSignIn } from '@rerun/cloud/app-review'
import { callerIp } from '@/lib/auth/caller-ip'
import { isPhoneCountry, toE164 } from '@/lib/phone/normalize'
import { createSessionlessClient } from '@/supabase/server'
import { type AppSession, mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// Signs into the account this number holds, or creates it, and hands the session to the app. Every
// try is counted before the code is looked at: a wrong one and the review code alike.
export const POST = apiRoute(mobileApi.signInWithPhone, { auth: 'public' }, async ({ req, body }): Promise<AppSession | Response> => {
    const phone = isPhoneCountry(body.country) ? toE164(body.phone, body.country) : null
    if (!phone) return phoneRefused('invalid_number')

    const attempt = await countVerifyAttempt(phone, callerIp(req.headers))
    if (attempt !== 'ok') return phoneRefused(attempt, attempt === 'too_many' ? VERIFY_WINDOW_MS / 1000 : undefined)

    const session = createSessionlessClient()
    const result = isAppReviewSignIn(phone, body.code) ? await completeAppReviewSignIn(session, phone) : await completePhoneSignIn(session, phone, body.code, body.channel)
    if (!result.ok) return phoneRefused(result.error)
    return { created: result.created, session: result.session }
})
