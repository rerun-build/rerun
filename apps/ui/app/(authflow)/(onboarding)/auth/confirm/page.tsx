import { Button } from '@/components/ui/button'
import { OnboardingDialog, OnboardingHeading } from '@/components/onboarding/OnboardingDialog'
import { routes } from '@/lib/routes'
import Link from 'next/link'
import { confirmLogin } from './actions'
import { getTranslations } from 'next-intl/server'

// Opening the link does not sign in: the emailed token works once and the browser's prefetch would
// spend it. The click, a POST through a server action, consumes it and opens the session.
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
    const { token_hash, type } = await searchParams
    const t = await getTranslations('auth.confirm')

    if (!token_hash || !type) {
        return (
            <OnboardingDialog stepKey="invalid">
                <div className="flex flex-col gap-6">
                    <OnboardingHeading title={t('invalidTitle')} subtitle={t('invalidMessage')} />
                    <Button asChild size="lg" className="w-full">
                        <Link href={routes.auth}>{t('newCode')}</Link>
                    </Button>
                </div>
            </OnboardingDialog>
        )
    }

    return (
        <OnboardingDialog stepKey="confirm">
            <div className="flex flex-col gap-6">
                <OnboardingHeading title={t('title')} subtitle={t('message')} />
                <form action={confirmLogin}>
                    <input type="hidden" name="token_hash" value={token_hash} />
                    <input type="hidden" name="type" value={type} />
                    <Button type="submit" size="lg" className="w-full">
                        {t('submit')}
                    </Button>
                </form>
            </div>
        </OnboardingDialog>
    )
}
