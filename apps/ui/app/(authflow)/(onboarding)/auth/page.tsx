import { BoardFocus } from '@/components/onboarding/BoardFocus'
import { OnboardingHeading } from '@/components/onboarding/OnboardingShell'
import { loadArrivalTeam } from '@/lib/onboarding/board-teams.server'
import { detectInAppBrowser, detectMobileOs } from '@/lib/in-app-browser'
import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { Suspense } from 'react'
import { AuthPageMethods } from './AuthPageMethods'

// Where the number sits is picked here, from the request, so a phone never paints the computer's
// layout first, nor an in-app browser the Google button it cannot use. Apple is drawn everywhere.
export default async function AuthPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
    const [userAgent, arrivalTeam] = await Promise.all([headers().then(list => list.get('user-agent') ?? ''), searchParams.then(search => loadArrivalTeam(search.next))])
    const phoneLeadsAlone = detectMobileOs(userAgent) !== null
    const showGoogle = !detectInAppBrowser(userAgent)
    const t = await getTranslations('auth.page')
    return (
        <div className="flex flex-col gap-6">
            <BoardFocus team={arrivalTeam} />
            <OnboardingHeading title={t('title')} subtitle={t('subtitle')} />
            <Suspense fallback={null}>
                <AuthPageMethods phoneLeadsAlone={phoneLeadsAlone} showGoogle={showGoogle} />
            </Suspense>
        </div>
    )
}
