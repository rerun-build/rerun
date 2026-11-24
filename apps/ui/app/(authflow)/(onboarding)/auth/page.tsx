import { AuthTerms } from '@/components/auth/AuthShell'
import { RerunOnly } from '@/components/brand/RerunOnly'
import { OnboardingDialog, OnboardingHeading } from '@/components/onboarding/OnboardingDialog'
import { ReferralInvite } from '@/ee/components/referrals/ReferralInvite'
import { REFERRAL_COOKIE } from '@/ee/lib/billing/referral'
import { referrerOfCode } from '@/ee/services/referral-attach.service'
import { isTellaAutoCapture } from '@/lib/auth/tella-auto-capture'
import { detectInAppBrowser, detectMobileOs } from '@/lib/in-app-browser'
import { getTranslations } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { Suspense } from 'react'
import { AuthPageMethods } from './AuthPageMethods'

// Where the number sits is picked here, from the request, so a phone never paints the computer's
// layout first, nor an in-app browser the Google button it cannot use. Apple is drawn everywhere.
export default async function AuthPage() {
    const requestHeaders = await headers()
    const userAgent = requestHeaders.get('user-agent') ?? ''
    const phoneLeadsAlone = detectMobileOs(userAgent) !== null
    const showGoogle = !detectInAppBrowser(userAgent)
    const t = await getTranslations('auth.page')
    const referrer = await referrerOfCode((await cookies()).get(REFERRAL_COOKIE)?.value)
    return (
        <OnboardingDialog stepKey="signin">
            <div className="flex flex-col gap-6">
                {referrer && (
                    <RerunOnly>
                        <ReferralInvite referrer={referrer} />
                    </RerunOnly>
                )}
                <OnboardingHeading title={t('title')} subtitle={t('subtitle')} />
                <Suspense fallback={null}>
                    <AuthPageMethods phoneLeadsAlone={phoneLeadsAlone} showGoogle={showGoogle} skipCaptcha={isTellaAutoCapture(requestHeaders)} />
                </Suspense>
                <p className="text-center text-xs text-muted-foreground">
                    <AuthTerms />
                </p>
            </div>
        </OnboardingDialog>
    )
}
