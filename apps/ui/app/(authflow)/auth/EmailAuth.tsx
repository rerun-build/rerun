'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { prepareEmailSignIn, resendLiveSignInCode } from '@/app/(authflow)/auth/actions'
import { EmailCodeForm, type EmailCodeStep } from '@/components/auth/EmailCodeForm'
import { useCaptcha } from '@/components/auth/captcha/useCaptcha'
import { EmailSendError, trackEmailSend } from '@/components/auth/email-send'
import { rememberSignInMethod } from '@/lib/auth/last-sign-in'
import { cn } from '@/lib/utils'
import { createClient } from '@/supabase/client'
import { SIGNUP_INTENT_COOKIE } from '@rerun/analytics'
import { setSharedCookie } from '@rerun/analytics/client'
import { useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'

// One flow for both sign-in and sign-up: the server opens the account first if the address is new,
// then Supabase mails the code. The intent cookie is only set when the server did open it: an
// existing account signing in on a new browser soon after its signup would otherwise be counted
// twice. A code mailed again keeps the cookie the first one set.
export default function EmailAuth({ beforeEmail, onStepChange, onSignedIn }: { beforeEmail?: ReactNode; onStepChange: (step: EmailCodeStep) => void; onSignedIn: () => void }) {
    const searchParams = useSearchParams()
    const errorText = useErrorText()
    const supabase = createClient()
    const { containerRef, challenging, getToken } = useCaptcha()

    const sendCode = (email: string) =>
        trackEmailSend(async () => {
            const live = await resendLiveSignInCode(email)
            if (live.resent) return live.held ? 'held' : undefined
            const prepared = await prepareEmailSignIn({ email, captcha: await getToken() })
            if (!prepared.ok) throw new EmailSendError(errorText(prepared), prepared.reason)
            if (prepared.created) setSharedCookie(SIGNUP_INTENT_COOKIE, 'email', 1)
            const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
            if (error) throw error
        })

    const verifyCode = async (email: string, code: string) => {
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
        if (error) throw error
        rememberSignInMethod('email')
        onSignedIn()
    }

    return (
        <div>
            <EmailCodeForm defaultEmail={searchParams.get('email') ?? ''} sendCode={sendCode} verifyCode={verifyCode} onStepChange={onStepChange} beforeEmail={beforeEmail} />
            <div ref={containerRef} className={cn('flex justify-center', challenging && 'mt-4')} />
        </div>
    )
}
