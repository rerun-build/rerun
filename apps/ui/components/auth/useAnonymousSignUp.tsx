'use client'

import { completeSignupAction, prepareAnonymousEmailStep, resendLiveSignInCode } from '@/app/(authflow)/auth/actions'
import { AuthMethods } from '@/components/auth/AuthMethods'
import { AnonymousEmailStep, type GetCaptchaToken } from '@/components/auth/AnonymousEmailStep'
import { OAuthSignInButton } from '@/components/auth/OAuthSignInButton'
import { PHONE_ENABLED } from '@/cloud/phone'
import { PhoneSignIn } from '@/cloud/phone.client'
import { useSignupFunnel } from '@/components/auth/useSignupFunnel'
import { rememberSignInMethod } from '@/lib/auth/last-sign-in'
import { signupStep } from '@/lib/auth/signup-abandon'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { createClient } from '@/supabase/client'
import { useOptionalSession } from '@/supabase/session/SessionProvider'
import { SIGNUP_INTENT_COOKIE, type SignupSurface } from '@rerun/analytics'
import { setSharedCookie } from '@rerun/analytics/client'
import { useRouter } from 'next/navigation'
import { useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ENABLED_OAUTH_PROVIDERS } from '@/lib/auth/oauth-providers'

const SETTLE_TIMEOUT_MS = 5_000

// How an anonymous visitor becomes an account, wherever the form is drawn: the account dialog and
// the arrival column mount the same thing. A brand-new email upgrades the anonymous user in place
// (updateUser, confirmed by an email_change code); an existing email signs them into that account
// instead. Either way the parked draft is flagged for replay (markResume) and the board finishes
// the job once the session settles.
//
// `active` is whether the form is on screen: it is what opens and closes the signup the funnel counts.
export function useAnonymousSignUp({ surface, active, onEntered }: { surface: SignupSurface; active: boolean; onEntered?: (created: boolean) => void }): { form: ReactNode; abandon: () => void; reset: () => void } {
    const [formKey, setFormKey] = useState(0)
    const supabase = createClient()
    const router = useRouter()
    const refreshUser = useOptionalSession()?.refreshUser
    const markResume = useOnboardingStore(s => s.markResume)
    const emailIsNew = useRef(false)
    const funnel = useSignupFunnel({ surface, active, initialStep: PHONE_ENABLED ? 'phone' : 'email' })

    const reset = () => {
        funnel.setStep(PHONE_ENABLED ? 'phone' : 'email')
        setFormKey(k => k + 1)
    }

    const sendCode = async (email: string, getToken: GetCaptchaToken) => {
        const prepared = await prepareAnonymousEmailStep({ email, captchaToken: await getToken() })
        if (!prepared.ok) throw new Error(prepared.error)
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
        const { error } = await supabase.auth.updateUser({ email })
        if (error) throw error
    }

    // Existing account: sign in. The anonymous workspace is left behind; the parked draft is replayed
    // on the account the user just signed into. New account: the code confirms the email the anonymous
    // user claimed, so the workspace, and the agent about to be created, stay on the same id.
    const verifyCode = async (email: string, code: string) => {
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: emailIsNew.current ? 'email_change' : 'email' })
        if (error) throw error
        rememberSignInMethod('email')
        await enter(emailIsNew.current)
    }

    // The signup is stamped by the server on the next request, and the phone wall or the foreman
    // only rise once this tab holds the stamp. Waiting for it here, with the code button still
    // pending, is what lets the dialog close onto the right screen. Never throws: the code was
    // right, and the forms would show it as wrong. Should the wait fail, the provider keeps asking.
    const settleSignup = async () => {
        try {
            await Promise.race([completeSignupAction(), new Promise(resolve => setTimeout(resolve, SETTLE_TIMEOUT_MS))])
        } catch {}
        await refreshUser?.().catch(() => {})
    }

    // A phone number follows the same two paths, decided on the server: a number no account holds
    // upgrades the anonymous user, a known one signs into its account. `markConverted` comes before
    // any await, so closing the dialog during the settle is not counted as an abandon.
    const enter = async (created: boolean) => {
        funnel.markConverted()
        markResume()
        await settleSignup()
        toast.success(created ? 'Account created!' : 'Welcome back!')
        onEntered?.(created)
        reset()
        router.refresh()
    }

    const leaveForProvider = () => {
        funnel.markConverted()
        markResume()
    }

    const form = (
        <AuthMethods
            key={formKey}
            onMethodChange={method => funnel.setStep(signupStep(method))}
            oauth={
                ENABLED_OAUTH_PROVIDERS.length > 0 && (
                    <>
                        {ENABLED_OAUTH_PROVIDERS.map(provider => (
                            <OAuthSignInButton key={provider} provider={provider} verb="Continue with" linkAnonymous onLeave={leaveForProvider} />
                        ))}
                    </>
                )
            }
            phone={PHONE_ENABLED ? surroundings => <PhoneSignIn onSignedIn={enter} onStepChange={step => funnel.setStep(signupStep('phone', step === 'code'))} {...surroundings} /> : undefined}
            email={beforeEmail => <AnonymousEmailStep sendCode={sendCode} verifyCode={verifyCode} onStepChange={step => funnel.setStep(signupStep('email', step === 'code'))} beforeEmail={beforeEmail} />}
        />
    )

    return { form, abandon: funnel.dismiss, reset }
}
