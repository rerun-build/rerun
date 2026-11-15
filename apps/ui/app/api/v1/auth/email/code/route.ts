import { claimEmailCodeAsk, ensureEmailAccount } from '@/app/api/_services/email-sign-up.service'
import { resendSignInCodeIfLive } from '@/app/api/_services/sign-in-code.service'
import { emailRefused } from '@/app/api/v1/auth/_lib/refusal'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { callerIp } from '@/lib/auth/caller-ip'
import { normalizeEmail } from '@/lib/email'
import { emailCodeRequestSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'public', body: emailCodeRequestSchema }, async ({ req, body }) => {
    const ip = callerIp(req.headers)
    if (!(await claimEmailCodeAsk(ip))) return emailRefused('too_many')

    const email = normalizeEmail(body.email)
    if (await resendSignInCodeIfLive(email, null)) return { mailed: true }

    const result = await ensureEmailAccount(email, ip)
    if (!result.ok) return emailRefused(result.error)
    return { mailed: false }
})
