import type { Metadata } from 'next'
import { AppBackdrop } from '@/components/onboarding/AppBackdrop'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('auth.page')
    return { title: t('metaTitle'), description: t('metaDescription') }
}

// The app stays behind while the page's dialog signs them in and asks its questions.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="h-dvh w-full overflow-hidden bg-background text-foreground selection:bg-primary/20">
            <AppBackdrop />
            {children}
        </div>
    )
}
