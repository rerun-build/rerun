import { claimEmailCodeAsk, ensureEmailAccount } from '@/app/api/_services/email-sign-up.service'
import { resendSignInCodeIfLive } from '@/app/api/_services/sign-in-code.service'
import { emailRefused, notOnThisHost } from '@/app/api/v1/auth/_lib/refusal'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { emailCodeForClient } from '@/app/api/v1/_lib/legacy-client'
import { callerIp } from '@/lib/auth/caller-ip'
import { isRerunHost } from '@/lib/brand/request-site'
import { normalizeEmail } from '@/lib/email'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// Same order as the web: a code still good is mailed again, since Supabase voids the previous one each
// time it mints a new one. Otherwise the address gets its account, and the app asks Supabase for a code.
// Whether the address was new stays here: said back, it would tell anyone who holds an account.
export const POST = apiRoute(mobileApi.sendEmailCode, { auth: 'public', invalidBody: () => emailRefused('invalid_email') }, async ({ req, body }) => {
    if (!(await isRerunHost())) return notOnThisHost()

    const ip = callerIp(req.headers)
    if (!(await claimEmailCodeAsk(ip))) return emailRefused('too_many')

    const email = normalizeEmail(body.email)
    if (await resendSignInCodeIfLive(email, null)) return emailCodeForClient(req, { mailed: true })

    const result = await ensureEmailAccount(email, ip)
    if (!result.ok) return emailRefused(result.error)
    return emailCodeForClient(req, { mailed: false })
})
