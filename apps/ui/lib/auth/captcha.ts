import 'server-only'

import type { CaptchaProof, CaptchaProvider } from '@/lib/auth/captcha-proof'
import { RERUN_CLOUD } from '@moldwright/cloud/edition'

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

export async function verifyCaptcha(proof: CaptchaProof | undefined, ip: string): Promise<boolean> {
    if (!process.env.TURNSTILE_SECRET_KEY && !process.env.HCAPTCHA_SECRET_KEY) return process.env.NODE_ENV !== 'production' || !RERUN_CLOUD
    if (!proof) return false
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
