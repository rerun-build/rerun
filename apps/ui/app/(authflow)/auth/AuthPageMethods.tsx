'use client'

import { AuthMethods } from '@/components/auth/AuthMethods'
import { OAuthSignInButton } from '@/components/auth/OAuthSignInButton'
import { PasswordSignInForm } from '@/components/auth/PasswordSignInForm'
import { PHONE_ENABLED } from '@rerun/cloud/phone'
import { PhoneSignIn } from '@rerun/cloud/phone.client'
import { useSignupFunnel } from '@/components/auth/useSignupFunnel'
import { ENABLED_OAUTH_PROVIDERS } from '@/lib/auth/oauth-providers'
import { signupStep } from '@/lib/auth/signup-abandon'
import { internalPath } from '@/lib/auth/internal-path'
import { routes } from '@/lib/routes'
import { useRouter, useSearchParams } from 'next/navigation'
import EmailAuth from './EmailAuth'
import { DesktopSignInWaiting } from '@/components/desktop-shell/DesktopSignInWaiting'
import { useDesktopSignInWaiting } from '@/components/desktop-shell/desktop-sign-in'

export function AuthPageMethods({ phoneLeadsAlone, showGoogle }: { phoneLeadsAlone: boolean; showGoogle: boolean }) {
    const searchParams = useSearchParams()
    const next = internalPath(searchParams.get('next'), routes.home)
    const router = useRouter()
    // A link that carries an address was written for the email form.
    const initialMethod = searchParams.get('email') || !PHONE_ENABLED ? 'email' : 'phone'
    const passwordOnly = searchParams.get('method') === 'password'
    const funnel = useSignupFunnel({ surface: 'auth_page', active: !passwordOnly, initialStep: initialMethod })
    const waitingForBrowser = useDesktopSignInWaiting()

    const enter = () => {
        funnel.markConverted()
        router.refresh()
        router.push(next)
    }

    if (passwordOnly) return <PasswordSignInForm onSignedIn={enter} />
    if (waitingForBrowser) return <DesktopSignInWaiting provider={waitingForBrowser} />

    return (
        <AuthMethods
            initialMethod={initialMethod}
            phoneLeadsAlone={phoneLeadsAlone}
            onMethodChange={method => funnel.setStep(signupStep(method))}
            oauth={
                ENABLED_OAUTH_PROVIDERS.length > 0 && (
                    <>
                        {showGoogle && ENABLED_OAUTH_PROVIDERS.includes('google') && <OAuthSignInButton provider="google" verb="Sign in with" onLeave={funnel.markConverted} />}
                        {ENABLED_OAUTH_PROVIDERS.includes('apple') && <OAuthSignInButton provider="apple" verb="Sign in with" onLeave={funnel.markConverted} />}
                    </>
                )
            }
            phone={PHONE_ENABLED ? surroundings => <PhoneSignIn onSignedIn={enter} onStepChange={step => funnel.setStep(signupStep('phone', step === 'code'))} {...surroundings} /> : undefined}
            email={beforeEmail => <EmailAuth beforeEmail={beforeEmail} onStepChange={step => funnel.setStep(signupStep('email', step === 'code'))} onSignedIn={enter} />}
        />
    )
}
