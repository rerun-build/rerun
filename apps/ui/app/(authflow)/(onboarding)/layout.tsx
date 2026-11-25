import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('auth.page')
    return { title: t('metaTitle'), description: t('metaDescription') }
}

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="h-dvh w-full overflow-hidden bg-background text-foreground selection:bg-primary/20">
            {children}
        </div>
    )
}
