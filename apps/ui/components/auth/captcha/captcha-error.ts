import type { CaptchaProof, CaptchaProvider } from '@/lib/auth/captcha-proof'
import { detectInAppBrowser } from '@/lib/in-app-browser'

const FAILED = 'We could not confirm you are not a robot. Try again.'
// An app's built-in browser can leave the check silent on every try, and it holds none of the
// visitor's sessions: their own browser is where both work.
const FAILED_IN_APP = 'Open this link in your browser to sign in.'

export type GetCaptchaToken = () => Promise<CaptchaProof | undefined>

// `code` is what the service said went wrong (Cloudflare's numbered client errors, hCaptcha's
// names), or `script` when its script never loaded. `superseded`: a newer send asked for a token
// while this one waited, so this wait is not a failure of the check.
export class CaptchaError extends Error {
    constructor(
        readonly provider: CaptchaProvider,
        readonly reason: 'captcha_failed' | 'captcha_timeout',
        readonly code?: string
    ) {
        super(detectInAppBrowser(navigator.userAgent) ? FAILED_IN_APP : FAILED)
    }

    // The message stays in English for analytics; the forms translate from this.
    get inAppBrowser() {
        return Boolean(detectInAppBrowser(navigator.userAgent))
    }

    get superseded() {
        return this.code === 'superseded'
    }

    get analytics() {
        return { reason: this.reason, captcha_provider: this.provider, ...(this.code ? { captcha_code: this.code } : {}) }
    }
}
