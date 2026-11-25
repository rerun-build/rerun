import { Button } from '@/components/ui/button'
import { OnboardingHeading, OnboardingPage, OnboardingStepLayout } from '@/components/onboarding/OnboardingPage'
import { TEAM_SIGN_IN_PARAM } from '@/lib/auth/team-session'
import { routes } from '@/lib/routes'
import Link from 'next/link'
import { confirmLogin } from './actions'
import { getTranslations } from 'next-intl/server'

// Opening the link does not sign in: the emailed token works once and the browser's prefetch would
// spend it. The click, a POST through a server action, consumes it and opens the session.
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; [TEAM_SIGN_IN_PARAM]?: string }> }) {
    const { token_hash, type, [TEAM_SIGN_IN_PARAM]: team } = await searchParams
    const t = await getTranslations('auth.confirm')

    if (!token_hash || !type) {
        return (
            <OnboardingPage stepKey="invalid" panel={null}>
                <OnboardingStepLayout heading={<OnboardingHeading title={t('invalidTitle')} subtitle={t('invalidMessage')} />}>
                    <Button asChild size="lg" className="w-full">
                        <Link href={routes.auth}>{t('newCode')}</Link>
                    </Button>
                </OnboardingStepLayout>
            </OnboardingPage>
        )
    }

    return (
        <OnboardingPage stepKey="confirm" panel={null}>
            <OnboardingStepLayout heading={<OnboardingHeading title={t('title')} subtitle={t('message')} />}>
                <form action={confirmLogin}>
                    <input type="hidden" name="token_hash" value={token_hash} />
                    <input type="hidden" name="type" value={type} />
                    {team && <input type="hidden" name={TEAM_SIGN_IN_PARAM} value={team} />}
                    <Button type="submit" size="lg" className="w-full">
                        {t('submit')}
                    </Button>
                </form>
            </OnboardingStepLayout>
        </OnboardingPage>
    )
}
