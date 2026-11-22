import 'server-only'

import { callerIp } from '@/lib/auth/caller-ip'
import type { CaptchaProof, CaptchaProvider } from '@/lib/auth/captcha-proof'
import { isTellaAutoCapture } from '@/lib/auth/tella-auto-capture'
import { RERUN_CLOUD } from '@rerun/cloud/edition'

type SiteverifyAnswer = { success?: boolean; 'error-codes'?: string[] }

const secretOf = (provider: CaptchaProvider) => (provider === 'turnstile' ? process.env.TURNSTILE_SECRET_KEY : process.env.HCAPTCHA_SECRET_KEY)

function siteverify(proof: CaptchaProof, secret: string, ip: string): Promise<Response> {
    if (proof.provider === 'turnstile') {
        return fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret, response: proof.token, remoteip: ip }),
        })
    }
    const body = new URLSearchParams({ secret, response: proof.token, remoteip: ip })
    const siteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY
    if (siteKey) body.set('sitekey', siteKey)
    return fetch('https://api.hcaptcha.com/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
}

// Whether the service that minted this token vouches for the visitor: Cloudflare's invisible check,
// or the hCaptcha puzzle the browser falls back to when Cloudflare is unsure. Where no secret is set
// at all, a local stack lets everyone through and Rerun Cloud lets nobody: a missing key must not
// open the tap. A self-hosted install has a captcha only once it sets keys. A token from a service
// whose secret is missing is refused, or naming that service would skip the check. Tella Auto
// Capture, which films the app, goes through without one.
export async function verifyCaptcha(proof: CaptchaProof | undefined, requestHeaders: Headers): Promise<boolean> {
    if (isTellaAutoCapture(requestHeaders)) {
        console.info('[captcha] skipped for Tella Auto Capture')
        return true
    }
    if (!process.env.TURNSTILE_SECRET_KEY && !process.env.HCAPTCHA_SECRET_KEY) return process.env.NODE_ENV !== 'production' || !RERUN_CLOUD
    if (!proof) return false
    const ip = callerIp(requestHeaders)
    const secret = secretOf(proof.provider)
    if (!secret) return false
    try {
        const answer = (await (await siteverify(proof, secret, ip)).json()) as SiteverifyAnswer
        if (!answer.success) console.error(`[captcha] ${proof.provider} token refused`, answer['error-codes'])
        return answer.success === true
    } catch (error) {
        console.error(`[captcha] ${proof.provider} siteverify failed`, error)
        return false
    }
}
