import { AuthTerms } from '@/components/auth/AuthShell'
import { RerunOnly } from '@/components/brand/RerunOnly'
import { OnboardingHeading, OnboardingPage, OnboardingStepLayout } from '@/components/onboarding/OnboardingPage'
import { ReferralInvite } from '@/ee/components/referrals/ReferralInvite'
import { REFERRAL_COOKIE } from '@/ee/lib/billing/referral'
import { referrerOfCode } from '@/ee/services/referral-attach.service'
import { isTellaAutoCapture } from '@/lib/auth/tella-auto-capture'
import { MOVED_PARAM } from '@/lib/brand/host-paths'
import { getBrand } from '@/lib/brand/server'
import { detectInAppBrowser, detectMobileOs } from '@/lib/in-app-browser'
import { isWhiteLabel } from '@rerun/contracts'
import { getTranslations } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { Suspense } from 'react'
import { AuthPageMethods } from './AuthPageMethods'

// Where the number sits is picked here, from the request, so a phone never paints the computer's
// layout first, nor an in-app browser the Google button it cannot use. Apple is drawn everywhere.
export default async function AuthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const requestHeaders = await headers()
    const userAgent = requestHeaders.get('user-agent') ?? ''
    const phoneLeadsAlone = detectMobileOs(userAgent) !== null
    const showGoogle = !detectInAppBrowser(userAgent)
    const t = await getTranslations('auth.page')
    const invitedOnly = isWhiteLabel(await getBrand())
    const moved = invitedOnly && (await searchParams)[MOVED_PARAM] !== undefined
    const referrer = invitedOnly ? null : await referrerOfCode((await cookies()).get(REFERRAL_COOKIE)?.value)
    return (
        <OnboardingPage
            stepKey="signin"
            panel={null}
            footer={
                <p className="max-w-sm pt-10 text-center text-xs text-muted-foreground text-balance">
                    <AuthTerms />
                </p>
            }
        >
            <OnboardingStepLayout heading={<OnboardingHeading title={invitedOnly ? t('invited.title') : t('title')} subtitle={moved ? t('invited.moved') : invitedOnly ? t('invited.subtitle') : t('subtitle')} />}>
                <div className="flex flex-col gap-6">
                    {referrer && (
                        <RerunOnly>
                            <ReferralInvite referrer={referrer} />
                        </RerunOnly>
                    )}
                    <Suspense fallback={null}>
                        <AuthPageMethods phoneLeadsAlone={phoneLeadsAlone} showGoogle={showGoogle} skipCaptcha={isTellaAutoCapture(requestHeaders)} invitedOnly={invitedOnly} />
                    </Suspense>
                </div>
            </OnboardingStepLayout>
        </OnboardingPage>
    )
}
