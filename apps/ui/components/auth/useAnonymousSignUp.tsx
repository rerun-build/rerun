'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { completeSignupAction, prepareAnonymousEmailStep, resendLiveSignInCode } from '@/app/(authflow)/auth/actions'
import { AuthMethods } from '@/components/auth/AuthMethods'
import type { AuthMethod } from '@/lib/auth/auth-method'
import { AnonymousEmailStep } from '@/components/auth/AnonymousEmailStep'
import type { GetCaptchaToken } from '@/components/auth/captcha/captcha-error'
import { EmailSendError, trackEmailSend } from '@/components/auth/email-send'
import { OAuthSignInButton } from '@/components/auth/OAuthSignInButton'
import { PHONE_ENABLED } from '@rerun/cloud/phone'
import { PhoneSignIn } from '@rerun/cloud/phone.client'
import { useSignupFunnel } from '@/components/auth/useSignupFunnel'
import { rememberSignInMethod } from '@/lib/auth/last-sign-in'
import { signupStep } from '@/lib/auth/signup-abandon'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { createClient } from '@/supabase/client'
import { useOptionalSession } from '@/supabase/session/SessionProvider'
import { SIGNUP_INTENT_COOKIE, type SignupSurface } from '@rerun/analytics'
import { setSharedCookie } from '@rerun/analytics/client'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ENABLED_OAUTH_PROVIDERS } from '@/lib/auth/oauth-providers'

const SETTLE_TIMEOUT_MS = 5_000

export function useAnonymousSignUp({ surface, active, onEntered }: { surface: SignupSurface; active: boolean; onEntered?: (created: boolean) => void }): { form: ReactNode; abandon: () => void; reset: () => void; movedOn: boolean } {
    const t = useTranslations('auth')
    const locale = useLocale()
    const [formKey, setFormKey] = useState(0)
    const [movedOn, setMovedOn] = useState(false)
    const errorText = useErrorText()
    const supabase = createClient()
    const router = useRouter()
    const refreshUser = useOptionalSession()?.refreshUser
    const markResume = useOnboardingStore(s => s.markResume)
    const emailIsNew = useRef(false)
    const funnel = useSignupFunnel({ surface, active, initialStep: PHONE_ENABLED ? 'phone' : 'email' })

    const reset = () => {
        funnel.setStep(PHONE_ENABLED ? 'phone' : 'email')
        setFormKey(k => k + 1)
        setMovedOn(false)
    }

    const sendCode = (email: string, getToken: GetCaptchaToken) =>
        trackEmailSend(async () => {
            const prepared = await prepareAnonymousEmailStep({ email, captcha: await getToken() })
            if (!prepared.ok) throw new EmailSendError(errorText(prepared), prepared.reason)
            const { exists } = prepared
            emailIsNew.current = !exists
            if (!exists) setSharedCookie(SIGNUP_INTENT_COOKIE, 'email', 1)
            const live = await resendLiveSignInCode(email)
            if (live.resent) return live.held ? 'held' : undefined
            if (exists) {
                const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
                if (error) throw error
                return
            }
            const { error } = await supabase.auth.updateUser({ email, data: { locale } })
            if (error) throw error
        })

    const verifyCode = async (email: string, code: string) => {
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: emailIsNew.current ? 'email_change' : 'email' })
        if (error) throw error
        rememberSignInMethod('email')
        await enter(emailIsNew.current)
    }

    const settleSignup = async () => {
        try {
            await Promise.race([completeSignupAction(), new Promise(resolve => setTimeout(resolve, SETTLE_TIMEOUT_MS))])
        } catch {}
        await refreshUser?.().catch(() => {})
    }

    const enter = async (created: boolean) => {
        funnel.markConverted()
        markResume()
        await settleSignup()
        toast.success(created ? t('accountCreated') : t('welcomeBack'))
        onEntered?.(created)
        reset()
        router.refresh()
    }

    const leaveForProvider = () => {
        funnel.markConverted()
        markResume()
    }

    const stepTo = (method: AuthMethod, codeSent: boolean) => {
        funnel.setStep(signupStep(method, codeSent))
        if (codeSent) setMovedOn(true)
    }

    const form = (
        <AuthMethods
            key={formKey}
            onMethodChange={method => {
                funnel.setStep(signupStep(method))
                setMovedOn(true)
            }}
            oauth={
                ENABLED_OAUTH_PROVIDERS.length > 0 && (
                    <>
                        {ENABLED_OAUTH_PROVIDERS.map(provider => (
                            <OAuthSignInButton key={provider} provider={provider} verb="Continue with" linkAnonymous onLeave={leaveForProvider} />
                        ))}
                    </>
                )
            }
            phone={PHONE_ENABLED ? surroundings => <PhoneSignIn onSignedIn={enter} onStepChange={step => stepTo('phone', step === 'code')} {...surroundings} /> : undefined}
            email={beforeEmail => <AnonymousEmailStep sendCode={sendCode} verifyCode={verifyCode} onStepChange={step => stepTo('email', step === 'code')} beforeEmail={beforeEmail} />}
        />
    )

    return { form, abandon: funnel.dismiss, reset, movedOn }
}
