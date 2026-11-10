'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { sendPhoneSignInCodeAction, verifyPhoneSignInCodeAction } from '@/app/api/_actions/phone.actions'
import { PhoneCodeForm, type PhoneCodeRequest, type PhoneCodeStep } from '@/components/auth/PhoneCodeForm'
import { sendPhoneCode } from '@/components/auth/phone-send'
import { useCaptcha } from '@/components/auth/captcha/useCaptcha'
import { rememberSignInMethod } from '@/lib/auth/last-sign-in'
import { detectInAppBrowser } from '@/lib/in-app-browser'
import { cn } from '@/lib/utils'
import { createClient } from '@/supabase/client'
import { SIGNUP_INTENT_COOKIE } from '@rerun/analytics'
import { setSharedCookie, track } from '@rerun/analytics/client'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

// Signs in with a phone number alone: the code sent to it opens the account that holds the number,
// or creates one. `created` tells the two apart once the session is open.
export function PhoneSignIn({
    onSignedIn,
    onStepChange,
    beforePhone,
    afterPhone,
    phoneLastUsed,
}: {
    onSignedIn: (created: boolean) => void | Promise<void>
    onStepChange?: (step: PhoneCodeStep) => void
    beforePhone?: ReactNode
    afterPhone?: ReactNode
    phoneLastUsed?: boolean
}) {
    const t = useTranslations('auth.phone')
    const errorText = useErrorText()
    const { containerRef, challenging, getToken } = useCaptcha()

    const sendCode = async (request: PhoneCodeRequest) => {
        track('signup_method_selected', { method: 'phone', in_app_browser: detectInAppBrowser(navigator.userAgent) ?? undefined })
        return sendPhoneCode('sign_in', request, async () => sendPhoneSignInCodeAction({ ...request, captcha: await getToken() }))
    }

    const verifyCode = async (code: string, request: PhoneCodeRequest) => {
        const result = await verifyPhoneSignInCodeAction({ ...request, code })
        if (!result.ok) throw new Error(errorText(result))
        track('phone_verification_completed', { channel: request.channel, context: 'sign_in' })
        // The server opened the session in the cookies, but an in-app browser may not show them to
        // the page yet: reading them back found the anonymous visitor and wrote it over the account.
        // The tokens handed back are stored as they are, and announced to everything listening.
        const { error } = await createClient().auth.setSession({ access_token: result.session.accessToken, refresh_token: result.session.refreshToken })
        if (error) throw new Error(t('errors.sessionFailed'))
        // SessionProvider reads it back to emit account_created, as it does for the other methods.
        if (result.created) setSharedCookie(SIGNUP_INTENT_COOKIE, 'phone', 1)
        rememberSignInMethod('phone')
        await onSignedIn(result.created)
    }

    return (
        <div>
            <PhoneCodeForm persistKey="phone-sign-in" sendCode={sendCode} verifyCode={verifyCode} onStepChange={onStepChange} beforePhone={beforePhone} afterPhone={afterPhone} phoneLastUsed={phoneLastUsed} />
            <div ref={containerRef} className={cn('flex justify-center', challenging && 'mt-4')} />
        </div>
    )
}
