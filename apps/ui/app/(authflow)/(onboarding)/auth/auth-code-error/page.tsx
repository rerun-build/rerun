import { Button } from '@/components/ui/button'
import { OnboardingDialog, OnboardingHeading } from '@/components/onboarding/OnboardingDialog'
import { routes } from '@/lib/routes'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export default async function AuthCodeErrorPage() {
    const t = await getTranslations('auth.linkExpired')
    return (
        <OnboardingDialog stepKey="link-expired">
            <div className="flex flex-col gap-6">
                <OnboardingHeading title={t('title')} subtitle={t('message')} />
                <Button asChild size="lg" className="w-full">
                    <Link href={routes.auth}>{t('newCode')}</Link>
                </Button>
            </div>
        </OnboardingDialog>
    )
}
