import type { CaptchaProof, CaptchaProvider } from '@/lib/auth/captcha-proof'
import { detectInAppBrowser } from '@/lib/in-app-browser'

const FAILED = 'We could not confirm you are not a robot. Try again.'
const FAILED_IN_APP = 'Open this link in your browser to sign in.'

export type GetCaptchaToken = () => Promise<CaptchaProof | undefined>

export class CaptchaError extends Error {
    constructor(
        readonly provider: CaptchaProvider,
        readonly reason: 'captcha_failed' | 'captcha_timeout',
        readonly code?: string
    ) {
        super(detectInAppBrowser(navigator.userAgent) ? FAILED_IN_APP : FAILED)
    }

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
