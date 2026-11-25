import { Button } from '@/components/ui/button'
import { OnboardingHeading, OnboardingPage, OnboardingStepLayout } from '@/components/onboarding/OnboardingPage'
import { LazyShowcase } from '@/components/onboarding/panels/LazyPanels'
import { routes } from '@/lib/routes'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export default async function AuthCodeErrorPage() {
    const t = await getTranslations('auth.linkExpired')
    return (
        <OnboardingPage stepKey="link-expired" panel={<LazyShowcase />}>
            <OnboardingStepLayout heading={<OnboardingHeading title={t('title')} subtitle={t('message')} />}>
                <Button asChild size="lg" className="w-full">
                    <Link href={routes.auth}>{t('newCode')}</Link>
                </Button>
            </OnboardingStepLayout>
        </OnboardingPage>
    )
}
