import { startPhoneSignIn } from '@/app/api/_services/phone-sign-in.service'
import { phoneRefused } from '@/app/api/v1/auth/_lib/refusal'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { appPlatformOf } from '@/app/api/v1/_lib/client-platform'
import { isAppReviewNumber } from '@rerun/cloud/app-review'
import { callerIp } from '@/lib/auth/caller-ip'
import { isPhoneCountry, toE164 } from '@/lib/phone/normalize'
import { verificationLanguage } from '@/lib/phone/verification'
import { phoneCodeRequestSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'public', body: phoneCodeRequestSchema }, async ({ req, body }) => {
    const phone = isPhoneCountry(body.country) ? toE164(body.phone, body.country) : null
    if (!phone) return phoneRefused('invalid_number')
    if (isAppReviewNumber(phone)) return { channel: body.channel }

    const result = await startPhoneSignIn(phone, body.channel, callerIp(req.headers), verificationLanguage(req.headers.get('accept-language')), null, appPlatformOf(req))
    if (result.ok) return { channel: result.channel }

    console.warn('[app-auth] phone code refused', result.error, body.channel, body.country)
    return phoneRefused(result.error, result.retryAfterSeconds)
})
