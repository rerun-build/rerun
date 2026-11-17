import { OnboardingHeading } from '@/components/onboarding/OnboardingShell'
import { detectInAppBrowser, detectMobileOs } from '@/lib/in-app-browser'
import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { Suspense } from 'react'
import { AuthPageMethods } from './AuthPageMethods'

// Where the number sits is picked here, from the request, so a phone never paints the computer's
// layout first, nor an in-app browser the Google button it cannot use. Apple is drawn everywhere.
export default async function AuthPage() {
    const userAgent = (await headers()).get('user-agent') ?? ''
    const phoneLeadsAlone = detectMobileOs(userAgent) !== null
    const showGoogle = !detectInAppBrowser(userAgent)
    const t = await getTranslations('auth.page')
    return (
        <div className="flex flex-col gap-6">
            <OnboardingHeading title={t('title')} subtitle={t('subtitle')} />
            <Suspense fallback={null}>
                <AuthPageMethods phoneLeadsAlone={phoneLeadsAlone} showGoogle={showGoogle} />
            </Suspense>
        </div>
    )
}
