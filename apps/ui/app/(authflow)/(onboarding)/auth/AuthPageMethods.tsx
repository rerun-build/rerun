'use client'

import { AuthMethods } from '@/components/auth/AuthMethods'
import { OAuthSignInButton } from '@/components/auth/OAuthSignInButton'
import { PasswordSignInForm } from '@/components/auth/PasswordSignInForm'
import { PHONE_ENABLED } from '@rerun/cloud/phone'
import { PhoneSignIn } from '@rerun/cloud/phone.client'
import { useSignupFunnel } from '@/components/auth/useSignupFunnel'
import { ENABLED_OAUTH_PROVIDERS, OAUTH_PROVIDER_CONFIG, type OAuthProvider } from '@/lib/auth/oauth-providers'
import { oauthErrorCode, oauthRetryCopy, withoutOAuthError } from '@/lib/auth/oauth-error'
import { oauthProviderLeftFor } from '@/lib/auth/oauth-sign-in'
import { track } from '@rerun/analytics/client'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { signupStep } from '@/lib/auth/signup-abandon'
import { writeAuthReturnCookie } from '@/lib/auth/auth-return'
import { internalPath } from '@/lib/auth/internal-path'
import { routes } from '@/lib/routes'
import { useRouter, useSearchParams } from 'next/navigation'
import EmailAuth from './EmailAuth'
import { DesktopSignInWaiting } from '@/components/desktop-shell/DesktopSignInWaiting'
import { DesktopServerLink } from '@/components/desktop-shell/DesktopServerLink'
import { useDesktopSignInWaiting } from '@/components/desktop-shell/desktop-sign-in'

const PATH_BASE = 'http://next.invalid'

export function AuthPageMethods({ phoneLeadsAlone, showGoogle }: { phoneLeadsAlone: boolean; showGoogle: boolean }) {
    const searchParams = useSearchParams()
    const tRetry = useTranslations('auth.oauthRetry')
    // A Google or Apple sign-in that failed upstream comes back to `/`, which sends it here with the
    // error folded into `next`: it is said here, and left out of where they go once signed in.
    const asked = new URL(internalPath(searchParams.get('next'), routes.home), PATH_BASE)
    const failure = oauthErrorCode(asked)
    const cleaned = withoutOAuthError(asked)
    const next = `${cleaned.pathname}${cleaned.search}`
    // Read from the cookie the click left, which the server render cannot see.
    const [provider, setProvider] = useState<OAuthProvider | null>(null)
    const retry = failure ? oauthRetryCopy(failure, provider ? OAUTH_PROVIDER_CONFIG[provider].label : null, tRetry) : null
    useEffect(() => {
        if (!failure) return
        const left = oauthProviderLeftFor()
        track('oauth_sign_in_failed', { code: failure, provider: left })
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setProvider(left)
    }, [failure])
    const router = useRouter()
    // A link that carries an address was written for the email form.
    const initialMethod = searchParams.get('email') || !PHONE_ENABLED ? 'email' : 'phone'
    const passwordOnly = searchParams.get('method') === 'password'
    const funnel = useSignupFunnel({ surface: 'auth_page', active: !passwordOnly, initialStep: initialMethod })
    const waitingForBrowser = useDesktopSignInWaiting()

    // Google and Apple come back through /auth/callback, which only knows where to go from this cookie.
    const leaveForProvider = () => {
        funnel.markConverted()
        writeAuthReturnCookie(next)
    }

    const enter = () => {
        funnel.markConverted()
        router.refresh()
        router.push(next)
    }

    if (passwordOnly) return <PasswordSignInForm onSignedIn={enter} />
    if (waitingForBrowser) return <DesktopSignInWaiting provider={waitingForBrowser} />

    return (
        <>
            {retry && (
                <div role="alert" className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                    <p className="font-medium text-foreground">{retry.title}</p>
                    <p className="text-muted-foreground">{retry.subtitle}</p>
                </div>
            )}
            <AuthMethods
                initialMethod={initialMethod}
                phoneLeadsAlone={phoneLeadsAlone}
                onMethodChange={method => funnel.setStep(signupStep(method))}
                oauth={
                    ENABLED_OAUTH_PROVIDERS.length > 0 && (
                        <>
                            {showGoogle && ENABLED_OAUTH_PROVIDERS.includes('google') && <OAuthSignInButton provider="google" verb="Sign in with" onLeave={leaveForProvider} />}
                            {ENABLED_OAUTH_PROVIDERS.includes('apple') && <OAuthSignInButton provider="apple" verb="Sign in with" onLeave={leaveForProvider} />}
                        </>
                    )
                }
                phone={PHONE_ENABLED ? surroundings => <PhoneSignIn onSignedIn={enter} onStepChange={step => funnel.setStep(signupStep('phone', step === 'code'))} {...surroundings} /> : undefined}
                email={beforeEmail => <EmailAuth beforeEmail={beforeEmail} onStepChange={step => funnel.setStep(signupStep('email', step === 'code'))} onSignedIn={enter} />}
            />
            <DesktopServerLink />
        </>
    )
}
